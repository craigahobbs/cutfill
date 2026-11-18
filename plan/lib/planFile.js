// planFile.js - the road plan model file - reading it, and its text

import {validatePlan} from '../../viewer/lib/model.js';


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
    const options = planValue !== null && typeof planValue === 'object' ? planValue.options : null;
    const siteOnly = options === undefined || (Array.isArray(options) && options.length === 0);
    const validated = validatePlan(siteOnly ? {...planValue, 'options': [siteOption]} : planValue);
    if ('error' in validated) {
        return {'error': [`error: The road plan "${planPath}" is invalid:`, '', validated.error]};
    }
    return {'plan': siteOnly ? {...validated.plan, 'options': []} : validated.plan};
}


// An option that stands in for a site's options, to validate the site's plan
const siteOption = {'name': 'Site', 'section': {'width': 1}, 'alignment': [{'x': 0, 'y': 0}, {'x': 1, 'y': 0}]};


// Order a road plan model's members, and create a road plan model file's text - the viewer's (the road plan model's)
export {orderPlan, planText} from '../../viewer/lib/model.js';
