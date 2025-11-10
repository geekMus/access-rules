const CHARSET_DEFAULT = 'utf-8';
const PREVIEW_TYPES = ['text/', 'image/', 'application/json', 'application/xml', 'application/javascript'];

// 检查内容类型是否应该预览
const shouldPreview = (contentType) => {
	if (!contentType) return false;

	return PREVIEW_TYPES.some((type) => contentType.includes(type));
};

// 解析正常状态码列表
const parseNormalStatusCodes = (statusCodesStr) => {
	if (!statusCodesStr) return [200];

	return statusCodesStr
		.split(',')
		.map((code) => parseInt(code.trim()))
		.filter((code) => !isNaN(code));
};

const buildReq = (request, env) => {
	const targetHost = env.GET_URL;

	// 如果没有配置GET_URL，返回null表示无法构建请求
	if (!targetHost) {
		return null;
	}

	const url = new URL(request.url);
	url.hostname = targetHost;
	url.port = '';
	url.protocol = 'https:';

	const requestInit = {
		method: request.method,
		headers: new Headers(request.headers),
		redirect: 'follow',
	};

	if (!['GET', 'HEAD'].includes(request.method)) {
		requestInit.body = request.body;
	}

	requestInit.headers.delete('host');
	requestInit.headers.delete('cf-connecting-ip');
	requestInit.headers.delete('cf-ipcountry');
	requestInit.headers.delete('cf-ray');
	requestInit.headers.delete('cf-visitor');
	requestInit.headers.delete('cdn-loop');
	requestInit.headers.set('host', targetHost);

	return {
		url: url.toString(),
		requestInit,
	};
};

// 自定义错误页面
const generateErrorPage = (statusCode, customMessage = null) => {
	let friendlyMessage = '';

	if (customMessage) {
		friendlyMessage = customMessage;
	} else {
		switch (statusCode) {
			case 404:
				friendlyMessage = '抱歉，您请求的资源未找到。';
				break;
			default:
				friendlyMessage = '请求的资源可能需要特殊权限才能访问，或者暂时不可用。';
		}
	}

	return new Response(
		`
		<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>${customMessage ? '配置错误' : '状态 ' + statusCode}</title>
			<style>
				* {
					margin: 0;
					padding: 0;
					box-sizing: border-box;
				}

				body {
					font-family: system-ui, -apple-system, sans-serif;
					min-height: 100vh;
					display: flex;
					align-items: center;
					justify-content: center;
					background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
					color: #333;
					line-height: 1.6;
				}

				.container {
					background: rgba(255, 255, 255, 0.95);
					border-radius: 16px;
					box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
					padding: 2.5rem;
					text-align: center;
					max-width: 90%;
					width: 450px;
					animation: fadeIn 0.4s ease-out;
				}

				@keyframes fadeIn {
					from {
						opacity: 0;
						transform: translateY(-15px);
					}
					to {
						opacity: 1;
						transform: translateY(0);
					}
				}

				.status-code {
					font-size: 4rem;
					font-weight: 700;
					background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
					-webkit-background-clip: text;
					-webkit-text-fill-color: transparent;
					background-clip: text;
					margin-bottom: 1rem;
					line-height: 1;
				}

				h1 {
					font-size: 1.5rem;
					font-weight: 600;
					color: #2d3748;
					margin-bottom: 1rem;
				}

				.message {
					font-size: 1.1rem;
					color: #4a5568;
					margin-bottom: 1.5rem;
				}

				.retry-message {
					font-size: 0.95rem;
					color: #718096;
					border-top: 1px solid #e2e8f0;
					padding-top: 1.5rem;
					margin-top: 1.5rem;
				}

				@media (max-width: 480px) {
					.container {
						padding: 1.8rem;
						width: auto;
					}

					.status-code {
						font-size: 3.5rem;
					}

					h1 {
						font-size: 1.3rem;
					}
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="status-code">${customMessage ? '!' : statusCode}</div>
				<h1>${customMessage ? '配置错误' : '请求状态'}</h1>
				<div class="message">${friendlyMessage}</div>
				${customMessage ? '' : '<div class="retry-message">请稍后再试</div>'}
			</div>
		</body>
		</html>
	`,
		{
			status: customMessage ? 500 : statusCode,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
			},
		}
	);
};

const getResponse = async (request, env) => {
	// 检查是否配置了GET_URL
	if (!env.GET_URL) {
		return generateErrorPage(0, '未配置 GET_URL，请先配置环境变量。');
	}

	const normalStatusCodes = parseNormalStatusCodes(env.NORMAL_STATUS_CODES);
	const requestData = buildReq(request, env);

	// 如果无法构建请求（比如GET_URL无效）
	if (!requestData) {
		return generateErrorPage(0, '无法构建请求，请检查环境变量配置。');
	}

	const { url, requestInit } = requestData;
	const response = await fetch(url, requestInit);

	if (!normalStatusCodes.includes(response.status)) {
		return generateErrorPage(response.status);
	}

	const newResponse = new Response(response.body, response);
	const contentType = newResponse.headers.get('Content-Type');
	const isPreview = shouldPreview(contentType);

	if (isPreview) newResponse.headers.set('Content-Type', `${contentType}; charset=${CHARSET_DEFAULT}`);
	newResponse.headers.set('Content-Disposition', isPreview ? 'inline' : 'attachment');

	return newResponse;
};

export default {
	async fetch(request, env) {
		return getResponse(request, env);
	},
};
