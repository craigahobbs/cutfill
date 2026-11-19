// doc.js - the road plan model documentation page

import {argsLink} from './args.js';
import {markdownHtml} from './markdown.js';
import {sageRoadTypes} from './model.js';
import {schemaDocMarkdown} from './schemaDoc.js';


// Build the model documentation page HTML
export function buildDoc(globals) {
    return {
        'title': 'SageRoad Road Plan Model',
        'html': `<p>${argsLink(globals, 'Back', {'doc': null})}</p>\n${markdownHtml(schemaDocMarkdown(sageRoadTypes, 'RoadPlan'))}`
    };
}
