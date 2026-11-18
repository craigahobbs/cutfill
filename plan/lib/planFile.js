// planFile.js - the road plan model file - reading it, and its text

import {validateSitePlan} from '../../viewer/lib/model.js';


// Read and validate a road plan model file - "io" is the tools' input and output functions. Returns an object with the
// "plan" or, if it can't be loaded or is invalid, the "error" text lines. A site's plan, without options yet (or
// without its options member), is a plan - its options are an empty array.
export function readPlan(io, planPath) {
    let planValue;
    try {
        planValue = JSON.parse(io.readFile(planPath));
    } catch {
        return {'error': [`error: Could not load the road plan "${planPath}"`]};
    }
    const validated = validateSitePlan(planValue);
    if ('error' in validated) {
        return {'error': [`error: The road plan "${planPath}" is invalid:`, '', validated.error]};
    }
    return validated;
}


// Order a road plan model's members, and create a road plan model file's text - the viewer's (the road plan model's)
export {orderPlan, planText} from '../../viewer/lib/model.js';
