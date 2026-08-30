# Arbejdsstatus

Sidst opdateret: 30. august 2026

## Aktiv fase

**Fase 9 — Entydige referencer i prosaen.** I gang.

Fase 0–8 er færdige og pushet. Udgangspunktet er commit `12febf6`. Den aftalte
fortsættelsesplan ligger i `docs/ROADMAP.md`.

## Færdigt i denne fase

- Roadmap og denne overdragelsesfil er oprettet.
- `CLAUDE.md` kræver, at begge læses før nyt arbejde.

## I gang nu

- Fastlæg den mindst mulige model for stabile, menneskelæselige arbejds-id'er,
  som overlever omdøbning og forgrening.

## Beslutninger

- En referencekode er et arbejdsredskab, ikke en del af bogens ordlyd.
- Omdøbning af et mål må ikke omskrive prosa.
- En slettet reference skal stå som brudt; den må ikke forsvinde tavst.
- Eksisterende ProseMirror-mærker videreføres frem for tegnpositioner.

## Verificering

- Ikke kørt endnu for fase 9.
- Sidste afsluttede fase havde 184 grønne prøver samt ren typecheck og build.

## Næste konkrete handling

Undersøg migrations- og forgreningsmønstret, tilføj referencekoder uden at gøre
dem afhængige af interne UUID'er, og skriv først prøverne for stabilitet gennem
omdøbning og forgrening.

## Åbne risici

- Koder skal være entydige i det rigtige omfang uden at blive ændret ved branch.
- Eksisterende ankre har ingen kode og skal fortsat kunne læses.
- En reference i prose-JSON og en række i `text_anchor` må ikke kunne drive fra
  hinanden uden en synlig brudt tilstand.
