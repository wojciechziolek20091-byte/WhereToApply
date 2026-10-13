import { DEFAULT_CONFIG } from '../src/sim/config';
import { computeHydroForces } from '../src/sim/hydro';
import { vec3 } from '../src/sim/math/vec';

const cfg = DEFAULT_CONFIG.hydro;

describe('hydro', () => {
  it('drags along the board', () => {
    const h = computeHydroForces(vec3(8, 0, 0), 0, 0, cfg);
    expect(h.force.x).toBeLessThan(0);
    expect(h.force.z).toBeCloseTo(0, 9);
    expect(h.edgeLoad).toBeCloseTo(0, 9);
  });

  it('resists sideways slip, harder with more edge', () => {
    // Heading east, sliding south (+z is right of east).
    const flat = computeHydroForces(vec3(8, 0, 1), 0, 0, cfg);
    const edged = computeHydroForces(vec3(8, 0, 1), 0, 1, cfg);
    expect(flat.force.z).toBeLessThan(0);
    expect(edged.edgeLoad).toBeGreaterThan(flat.edgeLoad * 2);
    expect(edged.vLat).toBeCloseTo(1, 9);
  });
});
