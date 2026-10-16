// Print the LayoutValidator table for the wake park and the beginner line (docs/LAYOUT.md, milestone 5).
import { formatLayoutTable, validateLayout } from '../src/park/layoutValidator';
import { BEGINNER_LINE, BEGINNER_PARK, WAKE_LAYOUT, WAKE_PARK } from '../src/sim/parkLayout';
console.log(WAKE_PARK.name);
console.log(formatLayoutTable(validateLayout(WAKE_PARK, WAKE_LAYOUT)));
console.log(`\n${BEGINNER_PARK.name}`);
console.log(formatLayoutTable(validateLayout(BEGINNER_PARK, BEGINNER_LINE, undefined, true)));
