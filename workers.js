/**
 * 🌐 Cloudflare Worker - 智能代理 + 可配置文件预览下载策略
 * ----------------------------------------------------------
 * 功能特性：
 * ✅ 根据 Content-Type 智能决定 inline / attachment
 * ✅ 支持 Cloudflare 环境变量自定义类型
 * ✅ 自动补全 charset=utf-8
 * ✅ 错误页面美观、轻量
 */

const CHARSET_DEFAULT = 'utf-8';
const NULL_BODY_STATUS_CODES = [101, 204, 205, 304];

/* -------------------- 工具函数 -------------------- */

// 解析状态码字符串 (例如 "200,201,302")
const parseNormalStatusCodes = (statusCodesStr) => {
	if (!statusCodesStr) return [200];
	return statusCodesStr
		.split(',')
		.map((code) => parseInt(code.trim()))
		.filter((code) => !isNaN(code));
};

// 从环境变量中解析 MIME 类型列表
const parseMimeList = (mimeStr) => {
	if (!mimeStr) return [];
	return mimeStr
		.split(',')
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
};

// 构建目标请求（代理）
const buildReq = (request, env) => {
	const targetHost = env.GET_URL;
	if (!targetHost) return null;

	const url = new URL(request.url);
	url.hostname = targetHost;
	url.port = '';
	url.protocol = 'https:';

	const requestInit = {
		method: request.method,
		headers: new Headers(request.headers),
		redirect: 'follow',
	};

	// 非 GET/HEAD 请求才包含 body
	if (!['GET', 'HEAD'].includes(request.method)) {
		requestInit.body = request.body;
	}

	// 删除 Cloudflare 特有头部，防止干扰
	const removeHeaders = ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cdn-loop'];
	removeHeaders.forEach((h) => requestInit.headers.delete(h));

	requestInit.headers.set('host', targetHost);

	return {
		url: url.toString(),
		requestInit,
	};
};

// 美观的错误页面
const generateErrorPage = (statusCode, customMessage = null) => {
	const msg = customMessage || (statusCode === 404 ? '抱歉，您请求的资源未找到。' : '请求的资源可能需要特殊权限才能访问，或者暂时不可用。');

	return new Response(
		`<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>${customMessage ? '配置错误' : '状态 ' + statusCode}</title>
			<style>
				body {
					font-family: system-ui, sans-serif;
					display: flex;
					justify-content: center;
					align-items: center;
					height: 100vh;
					margin: 0;
					background: #f4f6fb;
				}
				.container {
					text-align: center;
					background: white;
					padding: 2rem 3rem;
					border-radius: 12px;
					box-shadow: 0 5px 25px rgba(0,0,0,0.1);
				}
				.status { font-size: 4rem; color: #667eea; font-weight: bold; }
				h1 { margin: 0.5rem 0; color: #333; }
				p { color: #666; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="status">${customMessage ? '!' : statusCode}</div>
				<h1>${customMessage ? '配置错误' : '请求状态'}</h1>
				<p>${msg}</p>
			</div>
		</body>
		</html>`,
		{
			status: customMessage ? 500 : statusCode,
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		}
	);
};

/* -------------------- 预览/下载策略 -------------------- */

const getDisposition = (contentType, env) => {
	if (!contentType) return 'attachment';
	contentType = contentType.toLowerCase();

	// 从环境变量中动态加载强制规则
	const forceInlineList = parseMimeList(env.FORCE_INLINE_TYPES);
	const forceDownloadList = parseMimeList(env.FORCE_DOWNLOAD_TYPES);

	// 1️⃣ 优先检查强制预览类型
	if (forceInlineList.some((t) => contentType.includes(t))) return 'inline';

	// 2️⃣ 优先检查强制下载类型
	if (forceDownloadList.some((t) => contentType.includes(t))) return 'attachment';

	// 3️⃣ 常规自动判断逻辑
	if (contentType.startsWith('image/')) return 'inline';
	if (contentType.startsWith('text/')) return 'inline';
	if (contentType.includes('application/pdf')) return 'inline';

	// 其他预览
	const otherPreview = ['application/json', 'application/xml', 'application/javascript', 'text/javascript'];
	if (otherPreview.some((t) => contentType.includes(t))) return 'inline';

	// 4️⃣ 其他默认下载
	return 'attachment';
};

/* -------------------- 主逻辑 -------------------- */

const getResponse = async (request, env) => {
	if (!env.GET_URL) {
		return generateErrorPage(0, '未配置 GET_URL，请先配置环境变量。');
	}

	const normalStatusCodes = parseNormalStatusCodes(env.NORMAL_STATUS_CODES);
	const reqData = buildReq(request, env);
	if (!reqData) return generateErrorPage(0, '无法构建请求，请检查环境变量配置。');

	const { url, requestInit } = reqData;
	const response = await fetch(url, requestInit);

	// 检查状态码是否属于正常范围
	if (!normalStatusCodes.includes(response.status)) {
		if (NULL_BODY_STATUS_CODES.includes(response.status)) {
			return new Response(null, { status: response.status });
		}
		return generateErrorPage(response.status);
	}

	// 构建新响应
	const newResponse = new Response(NULL_BODY_STATUS_CODES.includes(response.status) ? null : response.body, response);

	// 自动补充 charset
	const contentType = newResponse.headers.get('Content-Type');
	if (contentType && contentType.startsWith('text/')) {
		newResponse.headers.set('Content-Type', `${contentType}; charset=${CHARSET_DEFAULT}`);
	}

	// 动态判定预览/下载策略
	const disposition = getDisposition(contentType, env);
	newResponse.headers.set('Content-Disposition', disposition);

	return newResponse;
};

/* -------------------- Cloudflare Worker 入口 -------------------- */

export default {
	async fetch(request, env) {
		return getResponse(request, env);
	},
};
