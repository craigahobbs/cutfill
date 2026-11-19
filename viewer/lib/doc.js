// doc.js - the road plan model documentation page

import {argsLink} from './args.js';
import {cutfillTypes} from './model.js';
import {markdownHtml} from './markdown.js';
import {schemaDocMarkdown} from './schemaDoc.js';


// Build the model documentation page HTML
export function buildDoc(globals) {
    return {
        'title': 'Cutfill Road Plan Model',
        'html': `<p>${argsLink(globals, 'Back', {'doc': null})}</p>\n${markdownHtml(schemaDocMarkdown(cutfillTypes, 'RoadPlan'))}`
    };
}
