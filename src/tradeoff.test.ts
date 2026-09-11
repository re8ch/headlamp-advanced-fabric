import { describe, expect, it } from 'vitest';
import { completeSamples, serviceProxyBase } from './contract';

describe('public observation contract', () => {
  it('discovers the API only through the advertised service reference', () => {
    expect(serviceProxyBase({ namespace: 'fabric-a', name: 'observations', port: 8080 })).toBe(
      '/api/v1/namespaces/fabric-a/services/http:observations:8080/proxy'
    );
  });

  it('draws only producer-complete coordinates and never substitutes null with zero', () => {
    const samples: any[] = [
      { time: 1, coordinates: { R: 0.2, D: 0.5, C: 0.9 }, confidence: {}, evidence: {} },
      { time: 2, coordinates: { R: 0.2, D: null, C: 0.9 }, confidence: {}, evidence: {} },
    ];
    expect(completeSamples(['R', 'D', 'C'], samples)).toEqual([samples[0]]);
    expect(samples[1].coordinates.D).toBeNull();
  });
});
