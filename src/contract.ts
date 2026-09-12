export type TriangleSample = {
  time: number;
  coordinates: Record<string, number | null>;
  confidence: Record<string, number>;
  evidence: Record<string, { state: string; missingSymbols?: string[] }>;
};

export function serviceProxyBase(serviceRef: { namespace: string; name: string; port: number }) {
  return `/api/v1/namespaces/${encodeURIComponent(
    serviceRef.namespace
  )}/services/http:${encodeURIComponent(serviceRef.name)}:${serviceRef.port}/proxy`;
}

export function completeSamples(vertices: string[], samples: TriangleSample[]) {
  return samples.filter(sample =>
    vertices.every(vertex => typeof sample.coordinates[vertex] === 'number')
  );
}

export function relationshipSeriesPath(relationshipId: string, subject: string) {
  return `/api/v1/relationships/${encodeURIComponent(
    relationshipId
  )}/series?subject=${encodeURIComponent(subject)}&maxPoints=7`;
}
