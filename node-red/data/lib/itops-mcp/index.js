'use strict';

/**
 * itops-mcp — klien MCP (Model Context Protocol) untuk portal ITOps.
 *
 * Endpoint : POST ITOPS_MCP_URL (JSON-RPC 2.0, stateless, balasan JSON langsung)
 * Auth     : Authorization: Bearer ITOPS_MCP_TOKEN
 *
 * Fitur:
 *  - status() : initialize + whoami + jumlah tool
 *  - tools()  : daftar tool (di-cache 10 menit)
 *  - call()   : panggil satu tool (tools/call)
 *  - ask()    : agentic loop — LLM memilih tool via function-calling,
 *               hasil tool di-eksekusi ke MCP, diulang maksimal MAX_ROUNDS.
 *               Fallback provider urut AI_PROVIDER_ORDER (groq→gemini→openrouter).
 */

const MAX_ROUNDS = 6;          // maksimal putaran tool-calling per pertanyaan
const TOOL_CACHE_MS = 10 * 60 * 1000;
const TOOL_RESULT_MAX = 12000; // batas karakter hasil tool
const HISTORY_MAX = 12;        // maksimal pesan riwayat per chat (user+assistant)

const SYSTEM_PROMPT = [
    'Kamu adalah asisten ITOps yang terhubung ke portal IT Operations (Project Plan & Event Log) lewat tool MCP.',
    'Selalu jawab dalam Bahasa Indonesia, ringkas, dan langsung ke inti — jawaban dikirim ke Telegram.',
    'Gunakan tool yang tersedia untuk mengambil data nyata; jangan mengarang.',
    'Alur yang disarankan: search_projects / search_tasks / search_event_logs untuk mencari, lalu get_* untuk detail.',
    'ATURAN PENTING create_task: JANGAN PERNAH memanggil create_task sendiri. Usulkan dulu seluruh field task kepada user dan minta persetujuan eksplisit. Setelah user menyetujui baru panggil get_task_options → preview_task → create_task dengan confirmation_code.',
    'Kalau tool gagal atau data tidak ada, sampaikan apa adanya.'
].join('\n');

function cfg() {
    return {
        url: process.env.ITOPS_MCP_URL || '',
        token: process.env.ITOPS_MCP_TOKEN || '',
        order: String(process.env.AI_PROVIDER_ORDER || 'groq,gemini,openrouter')
            .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    };
}

function provider(name) {
    const map = {
        groq:      ['GROQ_BASE_URL', 'GROQ_API_KEY', 'GROQ_MODEL'],
        gemini:    ['GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL'],
        openrouter:['OPENROUTER_BASE_URL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL']
    };
    const keys = map[name];
    if (!keys) return null;
    const base = process.env[keys[0]] || '';
    const key = process.env[keys[1]] || '';
    const model = process.env[keys[2]] || '';
    if (!base || !key || !model) return null;
    return { name, base, key, model };
}

async function postJson(body, timeoutMs) {
    const c = cfg();
    if (!c.url) throw new Error('ITOPS_MCP_URL belum diatur');
    if (!c.token) throw new Error('ITOPS_MCP_TOKEN belum diatur');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
    try {
        const res = await fetch(c.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                Authorization: 'Bearer ' + c.token
            },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        const text = await res.text();
        let j;
        try {
            // dukung balasan SSE (baris "data: {...}") maupun JSON langsung
            const lines = text.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6));
            j = JSON.parse(lines.length ? lines.join('\n') : text);
        } catch (e) {
            j = null;
        }
        if (!res.ok) {
            const msg = (j && j.error && j.error.message) || ('HTTP ' + res.status);
            const err = new Error('MCP ' + msg);
            err.status = res.status;
            throw err;
        }
        if (!j) throw new Error('Balasan MCP bukan JSON: ' + text.slice(0, 200));
        if (j.error) {
            const err = new Error('MCP ' + (j.error.message || 'error ' + j.error.code));
            err.code = j.error.code;
            throw err;
        }
        return j;
    } finally {
        clearTimeout(timer);
    }
}

let rpcId = 1;
async function rpc(method, params) {
    const j = await postJson({ jsonrpc: '2.0', id: rpcId++, method, params });
    return j.result;
}

function openaiTools(tools) {
    return tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: String(t.description || '').slice(0, 800),
            parameters: t.inputSchema || { type: 'object', properties: {} }
        }
    }));
}

function toolText(result) {
    if (!result) return '';
    if (Array.isArray(result.content)) {
        return result.content.map(c => c.text || '').join('\n');
    }
    return JSON.stringify(result);
}

class ItOpsMCP {
    constructor() {
        this._tools = null;
        this._toolsAt = 0;
        this._history = new Map(); // chatId -> messages[]
    }

    /** initialize + whoami + jumlah tool — untuk perintah status */
    async status() {
        const init = await rpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'ai-integrator', version: '3.2' }
        });
        const tools = await this.tools();
        let who = null;
        try {
            const r = await this.call('whoami', {});
            who = JSON.parse(r.text);
        } catch (e) { who = { error: e.message }; }
        return {
            server: (init && init.serverInfo) || null,
            instructions: (init && init.instructions) || '',
            tools,
            whoami: who
        };
    }

    /** daftar tool MCP (cache 10 menit) */
    async tools() {
        if (this._tools && Date.now() - this._toolsAt < TOOL_CACHE_MS) return this._tools;
        const r = await rpc('tools/list');
        this._tools = (r && r.tools) || [];
        this._toolsAt = Date.now();
        return this._tools;
    }

    /** panggil satu tool; hasil dibatasi TOOL_RESULT_MAX karakter */
    async call(name, args) {
        const r = await rpc('tools/call', { name, arguments: args || {} });
        let text = toolText(r);
        if (r && r.isError) text = 'ERROR: ' + text;
        if (text.length > TOOL_RESULT_MAX) text = text.slice(0, TOOL_RESULT_MAX) + '\n…(dipotong)';
        return { text, isError: !!(r && r.isError) };
    }

    clearHistory(chatId) { this._history.delete(chatId); }

    _hist(chatId) {
        if (!this._history.has(chatId)) this._history.set(chatId, []);
        return this._history.get(chatId);
    }

    /**
     * Agentic loop: LLM memilih tool → dieksekusi ke MCP → hasil dikembalikan
     * ke LLM → diulang hingga jawaban final (maks MAX_ROUNDS).
     * Fallback: bila satu provider error, provider berikutnya dipakai per putaran.
     */
    async ask(chatId, question) {
        const c = cfg();
        const tools = await this.tools();
        if (!tools.length) throw new Error('Tidak ada tool MCP tersedia');

        const history = this._hist(chatId);
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: String(question || '').slice(0, 2000) }
        ];
        const oaiTools = openaiTools(tools);
        const providers = c.order.map(provider).filter(Boolean);
        if (!providers.length) throw new Error('Tidak ada AI provider yang terkonfigurasi');

        let finalText = null;
        for (let round = 0; round < MAX_ROUNDS; round++) {
            const msg = await this._complete(providers, messages, oaiTools);
            const tc = msg.tool_calls || [];
            if (!tc.length) {
                finalText = String(msg.content || '').trim();
                break;
            }
            messages.push({ role: 'assistant', content: msg.content || '', tool_calls: tc });
            for (const t of tc) {
                let args = {};
                try { args = JSON.parse(t.function.arguments || '{}'); } catch (e) { /* argumen rusak -> {} */ }
                let out;
                try {
                    out = await this.call(t.function.name, args);
                } catch (e) {
                    out = { text: 'ERROR: ' + e.message, isError: true };
                }
                messages.push({ role: 'tool', tool_call_id: t.id, content: out.text });
            }
        }
        if (!finalText) {
            // habis putaran: minta ringkasan tanpa tool
            const msg = await this._complete(providers, messages, []);
            finalText = String(msg.content || '').trim();
        }
        if (!finalText) finalText = '(tidak ada jawaban dari AI)';

        // simpan riwayat (user + assistant final saja, tanpa isi tool → hemat token)
        history.push({ role: 'user', content: String(question).slice(0, 2000) },
                     { role: 'assistant', content: finalText.slice(0, 4000) });
        while (history.length > HISTORY_MAX) history.shift();

        return finalText;
    }

    /** chat/completions dengan fallback provider (per putaran) */
    async _complete(providers, messages, oaiTools) {
        let lastErr = null;
        for (const p of providers) {
            try {
                const body = { model: p.model, temperature: 0.2, messages };
                if (oaiTools && oaiTools.length) body.tools = oaiTools;
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 60000);
                let res;
                try {
                    res = await fetch(p.base.replace(/\/+$/, '') + '/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
                        body: JSON.stringify(body),
                        signal: ctrl.signal
                    });
                } finally { clearTimeout(timer); }
                const j = await res.json();
                if (!res.ok || !j.choices || !j.choices[0]) {
                    throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(j).slice(0, 200));
                }
                return j.choices[0].message;
            } catch (e) {
                lastErr = p.name + ': ' + e.message;
            }
        }
        throw new Error('Semua provider gagal (' + lastErr + ')');
    }
}

// singleton per modul (Node-RED libs = singleton per node, state aman)
module.exports = new ItOpsMCP();
module.exports.ItOpsMCP = ItOpsMCP;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
