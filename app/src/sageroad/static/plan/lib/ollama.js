// ollama.js - ask a model a question through Ollama's chat API (a local model's, or one of Ollama's cloud models')


// The default Ollama host - this computer's
export {ollamaHost as ollamaHostDefault} from '../../lib/models.js';


// The most tokens of a question's answer. A question's answer is a small JSON object, so a model that runs on is
// stopped here - its answer isn't JSON then, and the question fails. (A model that can't be kept from thinking
// thinks within the limit, too.)
const answerTokens = 2000;


// Ask a model a question - "fetchFn" is the fetch function, "host" is the Ollama host's URL, and the question is its
// "model", its "question" text, its "images" (PNG images' base64 text), and its answer's JSON "schema". The model
// answers with a JSON object of the schema, which is returned. Ollama holds a local model's answer to the schema, but
// not a cloud model's - so the question names the schema's members, and an answer's JSON may have text around it (a
// Markdown code block's, say). The answer's members are the caller's to check.
//
// The question is asked without thinking, and its answer is limited: a model that thinks about an image's question
// may think for minutes, and a request that's abandoned keeps the model busy. A model whose thinking can't be turned
// off is asked with it.
export async function ollamaAsk(fetchFn, host, {model, question, images = [], schema}) {
    const membersText = 'Answer with only a JSON object, with exactly these members: ' +
        `${schema.required.map((member) => `"${member}"`).join(', ')}.`;
    const post = async (thinkOff) => {
        const body = {
            model,
            'stream': false,
            ...(thinkOff ? {'think': false} : {}),
            'options': {'temperature': 0, 'num_predict': answerTokens},
            'format': schema,
            'messages': [{'role': 'user', 'content': `${question}\n\n${membersText}`, ...(images.length > 0 ? {images} : {})}]
        };
        let result;
        try {
            const response = await fetchFn(`${host}/api/chat`, {
                'method': 'POST', 'headers': {'content-type': 'application/json'}, 'body': JSON.stringify(body)
            });
            result = await response.json();
        } catch (error) {
            throw new Error(`Could not ask the model "${model}" at ${host} (${error.message})`, {'cause': error});
        }
        return result;
    };
    let result = await post(true);
    if (typeof result.error === 'string' && /think/i.test(result.error)) {
        result = await post(false);
    }
    if (typeof result.error === 'string') {
        throw new Error(`The model "${model}" failed (${result.error})`);
    }

    // The answer is the message's JSON object - the text from its first brace to its last
    let answer = null;
    try {
        answer = JSON.parse(result.message.content.match(/\{[\s\S]*\}/)[0]);
    } catch {
        // The answer isn't JSON
    }
    if (answer === null) {
        throw new Error(
            `The model "${model}" didn't answer with a JSON object` +
            `${result.done_reason === 'length' ? ' - its answer ran past the limit (a model that thinks at length can\'t be asked)' : ''}`
        );
    }
    return answer;
}
