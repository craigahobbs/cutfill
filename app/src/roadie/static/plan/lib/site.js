// site.js - the road site model: the start and end points of a road to plan, as latitudes and longitudes, and its
// planning instructions - the input of the "site" command

import {roadieTypes} from '../../viewer/lib/model.js';


// The road site model's type model - the road plan model's: a plan keeps the road site model it was made from (its
// "site" member), so the road site model is defined with the road plan model (Schema Markdown)
export const siteTypes = roadieTypes;


// Validate a road site model - returns an object with "site" on success, or "error" on failure
export {validateSite} from '../../viewer/lib/model.js';
