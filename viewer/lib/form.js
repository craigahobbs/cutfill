// form.js - a form for a Schema Markdown struct's value - the Roadie application's road site editor. The form is made
// from the struct's type model, so it has the model's members, and their documentation.

import {escapeHtml} from './format.js';


// Get the kind of a member's form control from its type - "string", "number", "enum", "struct", "strings" (an array
// of strings), or null for a type the form doesn't edit (its value is kept)
function memberKind(types, type) {
    if ('builtin' in type) {
        return {'string': 'string', 'float': 'number', 'int': 'number'}[type.builtin] ?? null;
    } else if ('array' in type) {
        return type.array.type.builtin === 'string' ? 'strings' : null;
    } else if ('user' in type) {
        return ['struct', 'enum'].find((kind) => kind in types[type.user]) ?? null;
    }
    return null;
}


// Get a member's label from its name - "maxGrade" is "Max grade"
function memberLabel(name) {
    const words = name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    return `${words[0].toUpperCase()}${words.slice(1)}`;
}


// Create a form's HTML - the controls of a struct's members, with its value's values. "types" is the type model,
// "typeName" is the struct's name, and "value" is the struct's value. A control's "data-member" attribute is its
// member's path ("start.latitude"). A required member's label has a "*", an optional struct is closed unless it has a
// value, and a member the form doesn't edit (an array of structs, say) is only noted, if it has a value.
export function formHtml(types, typeName, value = {}, path = '') {
    const parts = [];
    for (const {name, type, optional = false, doc = []} of types[typeName].struct.members) {
        const memberValue = value[name] ?? null;
        const kind = memberKind(types, type);
        const labelHtml = `<span class="roadie-form-name">${escapeHtml(memberLabel(name))}${optional ? '' : ' *'}</span>`;
        const docHtml = `<span class="roadie-form-doc">${escapeHtml(doc.join(' '))}</span>`;
        const memberAttr = `data-member="${path}${name}"`;
        if (kind === 'struct') {
            const membersHtml = formHtml(types, type.user, memberValue ?? {}, `${path}${name}.`);
            parts.push(optional ?
                `<details${memberValue !== null ? ' open' : ''}><summary>${labelHtml} ${docHtml}</summary>\n${membersHtml}\n</details>` :
                `<fieldset><legend>${labelHtml} ${docHtml}</legend>\n${membersHtml}\n</fieldset>`);
        } else if (kind === 'strings') {
            const text = Array.isArray(memberValue) ? memberValue.join('\n') : '';
            parts.push(`<p><label>${labelHtml} ${docHtml}<textarea ${memberAttr} rows="5">${escapeHtml(text)}</textarea></label></p>`);
        } else if (kind === 'enum') {
            const values = [...(optional ? [''] : []), ...types[type.user].enum.values.map((enumValue) => enumValue.name)];
            const optionsHtml = values.map((enumValue) => (
                `<option${enumValue === memberValue ? ' selected' : ''}>${escapeHtml(enumValue)}</option>`
            ));
            parts.push(`<p><label>${labelHtml} <select ${memberAttr}>${optionsHtml.join('')}</select></label> ${docHtml}</p>`);
        } else if (kind !== null) {
            const text = memberValue !== null ? `${memberValue}` : '';
            const sizeAttr = kind === 'number' ? ' size="12" inputmode="decimal"' : ' size="50"';
            parts.push(
                `<p><label>${labelHtml} <input type="text" ${memberAttr}${sizeAttr} value="${escapeHtml(text)}"></label> ${docHtml}</p>`
            );
        } else if (memberValue !== null) {
            parts.push(`<p>${labelHtml} ${docHtml} <em>It isn't edited here - it's kept as it is.</em></p>`);
        }
    }
    return parts.join('\n');
}


// Get a form's value - "element" is the form's element, and "value" is the value the form was made with: its members
// that the form doesn't edit are kept. A control without text has no value - its member is omitted, as is an optional
// struct without members. A number's text that isn't a number is its value, for the model's validation to report.
export function formValue(types, typeName, element, value = {}, path = '') {
    const result = {};
    for (const {name, type, optional = false} of types[typeName].struct.members) {
        const kind = memberKind(types, type);
        const text = (element.querySelector(`[data-member="${path}${name}"]`)?.value ?? '').trim();
        let memberValue = null;
        if (kind === 'struct') {
            memberValue = formValue(types, type.user, element, value[name] ?? {}, `${path}${name}.`);
            memberValue = optional && Object.keys(memberValue).length === 0 ? null : memberValue;
        } else if (kind === 'strings') {
            const strings = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
            memberValue = strings.length > 0 ? strings : null;
        } else if (kind === null) {
            memberValue = value[name] ?? null;
        } else if (text !== '') {
            memberValue = kind === 'number' && !Number.isNaN(Number(text)) ? Number(text) : text;
        }
        if (memberValue !== null) {
            result[name] = memberValue;
        }
    }
    return result;
}


// A point's text - a latitude and a longitude, as a map copies them ("46.16755, -119.16811")
const rePoint = /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/;


// Paste a point's text into a form's latitude - it's the latitude and its longitude. "element" is the form's element,
// and "event" is its paste event.
export function formPastePoint(element, event) {
    const {member = ''} = event.target.dataset;
    const match = event.clipboardData.getData('text').match(rePoint);
    const longitude = member.endsWith('latitude') ? element.querySelector(`[data-member="${member.slice(0, -8)}longitude"]`) : null;
    if (match !== null && longitude !== null) {
        event.preventDefault();
        [, event.target.value, longitude.value] = match;
    }
}
