export interface FindingSubjects {
  events?: string[];
  entities?: string[];
  facts?: string[];
  rows?: string[];
}

export interface FindingTarget {
  label: string;
  href: string;
}

/** Stable, human-readable jumps from engine findings back to story material. */
export function findingTargets(
  subjects: FindingSubjects,
  entities: { id: string; name: string; kind: string }[],
  events: { id: string; title: string }[],
  facts: { id: string; summary: string }[],
  chapters: { title: string; scenes: { id: string; title: string | null }[] }[],
): FindingTarget[] {
  const ids = new Set([
    ...(subjects.entities ?? []), ...(subjects.events ?? []), ...(subjects.facts ?? []),
    ...(subjects.rows ?? []),
  ]);
  const targets: FindingTarget[] = [];
  for (const id of ids) {
    const entity = entities.find((item) => item.id === id);
    if (entity && ['person', 'place', 'object'].includes(entity.kind)) {
      const route = entity.kind === 'person' ? 'personer' : entity.kind === 'place' ? 'steder' : 'ting';
      targets.push({ label: entity.name, href: `${route}?id=${encodeURIComponent(id)}` });
    }
    const event = events.find((item) => item.id === id);
    if (event) targets.push({ label: event.title, href: `events?id=${encodeURIComponent(id)}` });
    const fact = facts.find((item) => item.id === id);
    if (fact) targets.push({ label: fact.summary, href: `fakta?id=${encodeURIComponent(id)}` });
    for (const chapter of chapters) {
      const scene = chapter.scenes.find((item) => item.id === id);
      if (scene) targets.push({ label: `${chapter.title} · ${scene.title ?? 'scene uden titel'}`, href: `skrivebord?scene=${encodeURIComponent(id)}` });
    }
  }
  return [...new Map(targets.map((target) => [target.href, target])).values()].slice(0, 5);
}
