import assert from 'node:assert/strict';
import {ollamaAsk} from '../lib/ollama.js';
import test from 'node:test';


// Create a fetch function of Ollama's responses - each is a response's JSON object (or an Error, for a request that
// fails). The function records its "requests" (each request's URL and its body's object).
function ollamaFetch(responses) {
    const fetchFn = (url, {method, headers, body}) => {
        fetchFn.requests.push({url, method, headers, 'body': JSON.parse(body)});
        const response = responses[fetchFn.requests.length - 1];
        return response instanceof Error ? Promise.reject(response) : Promise.resolve({'json': () => Promise.resolve(response)});
    };
    fetchFn.requests = [];
    return fetchFn;
}


// A question, and its text's answer members
const schema = {
    'type': 'object', 'properties': {'found': {'type': 'boolean'}, 'why': {'type': 'string'}}, 'required': ['found', 'why']
};
const question = {'model': 'test-model', 'question': 'Is it there?', schema};
const membersText = 'Answer with only a JSON object, with exactly these members: "found", "why".';


test('ollamaAsk', async () => {
    // A question is one chat message - without thinking, with a limited answer of the question's schema
    const fetchFn = ollamaFetch([{'message': {'content': '{"found": true}'}, 'done_reason': 'stop'}]);
    assert.deepEqual(await ollamaAsk(fetchFn, 'http://host:1', question), {'found': true});
    assert.deepEqual(fetchFn.requests, [{
        'url': 'http://host:1/api/chat',
        'method': 'POST',
        'headers': {'content-type': 'application/json'},
        'body': {
            'model': 'test-model',
            'stream': false,
            'think': false,
            'options': {'temperature': 0, 'num_predict': 2000},
            'format': schema,
            'messages': [{'role': 'user', 'content': `Is it there?\n\n${membersText}`}]
        }
    }]);

    // A question's images are the message's
    const imageFetch = ollamaFetch([{'message': {'content': '{"found": false}'}}]);
    assert.deepEqual(await ollamaAsk(imageFetch, 'http://host:1', {...question, 'images': ['AAAA']}), {'found': false});
    assert.deepEqual(imageFetch.requests[0].body.messages, [
        {'role': 'user', 'content': `Is it there?\n\n${membersText}`, 'images': ['AAAA']}
    ]);

    // An answer's JSON object may have text around it - a cloud model's answer is a Markdown code block
    const fenced = ollamaFetch([{'message': {'content': 'Here it is:\n```json\n{\n  "found": true\n}\n```\n'}}]);
    assert.deepEqual(await ollamaAsk(fenced, 'http://host:1', question), {'found': true});
});


test('ollamaAsk, a model whose thinking can\'t be turned off', async () => {
    // The model is asked again, as it is
    const fetchFn = ollamaFetch([
        {'error': 'invalid think value: "false" for this model'}, {'message': {'content': '{"found": true}'}}
    ]);
    assert.deepEqual(await ollamaAsk(fetchFn, 'http://host:1', question), {'found': true});
    assert.deepEqual(fetchFn.requests.map(({body}) => 'think' in body), [true, false]);
});


test('ollamaAsk, failures', async () => {
    const failure = async (responses) => {
        try {
            await ollamaAsk(ollamaFetch(responses), 'http://host:1', question);
        } catch ({message}) {
            return message;
        }
        return null;
    };

    // The model fails, or it can't be reached
    assert.equal(await failure([{'error': 'model not found'}]), 'The model "test-model" failed (model not found)');
    assert.equal(await failure([{'error': 'no thinking'}, {'error': 'no thinking'}]), 'The model "test-model" failed (no thinking)');
    assert.equal(
        await failure([new Error('fetch failed')]), 'Could not ask the model "test-model" at http://host:1 (fetch failed)'
    );

    // The answer isn't a JSON object - or it ran past its limit
    const notJson = 'The model "test-model" didn\'t answer with a JSON object';
    assert.equal(await failure([{'message': {'content': 'It is there.'}, 'done_reason': 'stop'}]), notJson);
    assert.equal(await failure([{'message': {'content': '[true]'}}]), notJson);
    assert.equal(await failure([{'message': {'content': '{"found": true'}}]), notJson);
    assert.equal(await failure([{'message': {'content': 'null'}}]), notJson);
    assert.equal(await failure([{}]), notJson);
    assert.equal(
        await failure([{'message': {'content': ''}, 'done_reason': 'length'}]),
        `${notJson} - its answer ran past the limit (a model that thinks at length can't be asked)`
    );
});
