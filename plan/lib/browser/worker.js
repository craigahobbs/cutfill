// worker.js - the worker that makes a road's plan for the SageRoad application's page (io.js's planRoad), so the page
// goes on while it's made

import {workerMessage} from './io.js';


globalThis.onmessage = ({data}) => workerMessage(globalThis, data);
