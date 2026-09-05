import type { Block, Document, ParagraphStyle, Run } from './document';
import { zipBytes, type ZipEntry } from './zip';

/**
 * A .docx, written by hand.
 *
 * A Word file is a ZIP of XML parts, and the subset a novel needs is small:
 * paragraphs, runs, a handful of styles and a page size. What a library would
 * add is everything a novel does not have -- tables, images, footnotes,
 * tracked changes -- in exchange for a dependency in the path every finished
 * manuscript leaves through.
 *
 * The styles are the useful part. Prose comes out in a manuscript's own shape:
 * a serif at twelve points, one and a half lines apart, every paragraph
 * indented except the one that opens a scene, and every chapter starting on a
 * fresh page. That is what an editor expects to receive, and it is tedious to
 * apply by hand to eighty thousand words.
 */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/**
 * Escapes text for XML, and drops what XML cannot hold at all.
 *
 * Control characters have no representation in XML 1.0, and a single one
 * pasted in from somewhere else would make the whole file unopenable -- a
 * silent drop is the only outcome that still hands the writer their book.
 */
function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runXml(run: Run): string {
  if (run.lineBreak) return '<w:r><w:br/></w:r>';
  if (!run.text) return '';
  const marks = [
    run.bold ? '<w:b/>' : '',
    run.italic ? '<w:i/>' : '',
    run.strike ? '<w:strike/>' : '',
    run.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : '',
  ].join('');
  const properties = marks ? `<w:rPr>${marks}</w:rPr>` : '';
  // `xml:space` is kept explicitly: Word trims a run's leading space
  // otherwise, and a space between two differently marked words is not
  // decoration.
  return `<w:r>${properties}<w:t xml:space="preserve">${xml(run.text)}</w:t></w:r>`;
}

const PARAGRAPH_STYLE: Record<ParagraphStyle, string> = {
  prose: 'Prosa',
  prose_first: 'ProsaFoerste',
  plain: 'Normal',
  note: 'Note',
};

function paragraph(style: string, runs: Run[], extra = ''): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>`
    + `${runs.map(runXml).join('')}</w:p>`;
}

function blockXml(block: Block): string {
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level, 1), 4);
      return paragraph(
        `Overskrift${level}`, block.runs,
        block.startsPage ? '<w:pageBreakBefore/>' : '',
      );
    }
    case 'paragraph':
      return paragraph(PARAGRAPH_STYLE[block.style ?? 'plain'], block.runs);
    case 'quote':
      return block.blocks.map((child) => (child.kind === 'paragraph'
        ? paragraph('Citat', child.runs)
        : blockXml(child))).join('');
    case 'list':
      // Bullets and numbers are written into the text rather than declared in
      // a numbering part. A real list needs numbering.xml, an abstract
      // definition and an instance per list, so that Word can renumber lists
      // this program never edits again. The hanging indent is the part that
      // actually shows.
      return block.items.map((item, i) => {
        const label = block.ordered ? `${i + 1}.\t` : '•\t';
        const runs = item.flatMap((child) => (child.kind === 'paragraph' ? child.runs : []));
        return paragraph('Liste', [{ text: label }, ...runs]);
      }).join('');
    case 'code':
      return block.text.split('\n')
        .map((line) => paragraph('Kode', [{ text: line }])).join('');
    case 'separator':
      return paragraph('Scenebrud', [{ text: '⁂' }]);
  }
}

/** Half-points, the unit Word measures type in. */
const size = (points: number) => points * 2;

function styleXml(): string {
  const style = (
    id: string, name: string, body: string, basedOn = 'Normal',
  ) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>`
    + `<w:basedOn w:val="${basedOn}"/>${body}</w:style>`;

  return `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + '<w:docDefaults><w:rPrDefault><w:rPr>'
    + '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>'
    + `<w:sz w:val="${size(12)}"/><w:lang w:val="da-DK"/>`
    + '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>'
    // 360 twentieths of a line is one and a half lines; `auto` lets Word keep
    // the ratio when the reader changes the font.
    + '<w:spacing w:line="360" w:lineRule="auto" w:after="0"/>'
    + '</w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
    + '<w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>'
    + style('Prosa', 'Prosa', '<w:pPr><w:ind w:firstLine="709"/></w:pPr>')
    + style('ProsaFoerste', 'Prosa, foerste', '<w:pPr><w:ind w:firstLine="0"/></w:pPr>', 'Prosa')
    + style('Titel', 'Title', '<w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr>'
      + `<w:rPr><w:b/><w:sz w:val="${size(28)}"/></w:rPr>`)
    + style('Undertitel', 'Subtitle', '<w:pPr><w:spacing w:after="480"/><w:jc w:val="center"/></w:pPr>'
      + `<w:rPr><w:i/><w:sz w:val="${size(14)}"/></w:rPr>`)
    + style('Overskrift1', 'heading 1', '<w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/></w:pPr>'
      + `<w:rPr><w:b/><w:sz w:val="${size(18)}"/></w:rPr>`)
    + style('Overskrift2', 'heading 2', '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/></w:pPr>'
      + `<w:rPr><w:b/><w:sz w:val="${size(14)}"/></w:rPr>`)
    + style('Overskrift3', 'heading 3', '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr>'
      + `<w:rPr><w:b/><w:sz w:val="${size(12)}"/></w:rPr>`)
    + style('Overskrift4', 'heading 4', '<w:pPr><w:keepNext/><w:spacing w:before="240"/></w:pPr>'
      + `<w:rPr><w:i/><w:sz w:val="${size(12)}"/></w:rPr>`)
    + style('Scenebrud', 'Scenebrud', '<w:pPr><w:spacing w:before="240" w:after="240"/>'
      + '<w:jc w:val="center"/></w:pPr>')
    + style('Citat', 'Quote', '<w:pPr><w:ind w:left="709" w:right="709"/></w:pPr><w:rPr><w:i/></w:rPr>')
    + style('Liste', 'List Paragraph', '<w:pPr><w:ind w:left="709" w:hanging="360"/></w:pPr>')
    + style('Note', 'Note', `<w:rPr><w:sz w:val="${size(10)}"/></w:rPr>`)
    + style('Kode', 'Kode', '<w:pPr><w:spacing w:after="0"/></w:pPr>'
      + '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr>')
    + '</w:styles>';
}

function documentXml(document: Document): string {
  const head = [
    paragraph('Titel', [{ text: document.title }]),
    document.subtitle ? paragraph('Undertitel', [{ text: document.subtitle }]) : '',
  ].join('');
  return `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + head
    + document.blocks.map(blockXml).join('')
    // A4 with 2,5 cm margins. Without a section at the end Word supplies its
    // own, which is US Letter on a good many machines.
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"'
    + ' w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

function corePropertiesXml(document: Document): string {
  const when = (document.createdAt ?? new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  return `${XML_HEAD}<cp:coreProperties`
    + ' xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${xml(document.title)}</dc:title>`
    + (document.subtitle ? `<dc:subject>${xml(document.subtitle)}</dc:subject>` : '')
    + '<cp:lastModifiedBy>Fabula &amp; Sujet</cp:lastModifiedBy>'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>`
    + '</cp:coreProperties>';
}

const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function toDocx(document: Document): Buffer {
  const parts: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      bytes: Buffer.from(`${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        + '</Types>', 'utf8'),
    },
    {
      name: '_rels/.rels',
      bytes: Buffer.from(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="word/document.xml"/>`
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        + '</Relationships>', 'utf8'),
    },
    {
      name: 'word/_rels/document.xml.rels',
      bytes: Buffer.from(`${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/>`
        + '</Relationships>', 'utf8'),
    },
    { name: 'word/document.xml', bytes: Buffer.from(documentXml(document), 'utf8') },
    { name: 'word/styles.xml', bytes: Buffer.from(styleXml(), 'utf8') },
    { name: 'docProps/core.xml', bytes: Buffer.from(corePropertiesXml(document), 'utf8') },
  ];
  return zipBytes(parts, document.createdAt ?? new Date());
}
