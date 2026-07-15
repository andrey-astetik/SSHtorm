const axios = require('axios');

module.exports = async (model='llama3.2:3b',messages=[],params={
    temperature: 1,
    top_p: 1,
    presence_penalty: 0,
	frequency_penalty: 0,
	repeat_penalty: 0,
    tools: null,
    parallel_tool_calls: false,
    response_format: null,
    stop: null,
    user: null,
    max_tokens: null,
    seed: null
}) => {
	data = {
		model: model,
		messages: messages,
		stream: false,
        parallel_tool_calls: params.parallel_tool_calls,
        repeat_penalty: params.repeat_penalty,
        presence_penalty: params.presence_penalty,
		frequency_penalty: params.presence_penalty,
        response_format: params.response_format,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        top_p: params.top_p,
        tools: params.tools,
        stop: params.stop,
        user: params.user,
        seed: params.seed
	};
	try {
		let resp = await axios({
			method: 'post',
			url: 'http://localhost:11434/api/chat',
			headers: {
				'Content-type': 'application/json; charset=UTF-8'
			},
			timeout: 60*1e3,
			data: data
		});

		console.log(resp);
		if (resp != undefined && resp.data != undefined && resp.data.message != undefined) {
			// console.log(resp.data);
			return resp.data.message;
		} else {
			return false;
		}
	} catch(_) {
		// console.log(_);
		if (_?.response != undefined) {
			console.log(_.response?.data);
		}
		console.log('Req error');
		return false;
	}
}