        // ============================================
        // 全局状态
        // ============================================
        let questions = [];
        let currentQuestion = null;
        let originalCode = "";
        let editor = null;
        let questionPassed = false;
        let currentLang = "cpp";
        const questionCache = {};
        let savedCodeCache = {};

        const TEMPLATE_CPP = '#include<bits/stdc++.h>\n\nusing namespace std;\n\nint main( )\n{\n    return 0;\n}';

        // ============================================
        // CodeMirror 初始化
        // ============================================
        function initEditor() {
            // 在 CodeMirror 创建前先应用保存的字体大小，避免渲染后改变导致错位
            var initSize = getEditorFontSize();
            document.documentElement.style.setProperty("--editor-font-size", initSize + "px");
            const ta = document.getElementById("codeEditor");
            editor = CodeMirror.fromTextArea(ta, {
                mode: "text/x-c++src",
                theme: "monokai",
                lineNumbers: true,
                indentUnit: 4,
                smartIndent: true,
                autoCloseBrackets: true,
                matchBrackets: true,
                lineWrapping: false,
                foldGutter: true,
                gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
                extraKeys: {
                    "Ctrl-Space": "autocomplete",
                    "Tab": function(cm) { cm.replaceSelection("    "); },
                    "Ctrl-/": "toggleComment",
                    "Ctrl-Shift-[": function(cm) { cm.foldCode(cm.getCursor()); },
                    "Ctrl-Shift-]": function(cm) { cm.unfoldCode(cm.getCursor()); },
                    "Ctrl-Q": function(cm) { cm.foldCode(cm.getCursor()); }
                },
                foldOptions: { widget: "⋯" }
            });
            // 响应式调整
            window.addEventListener("resize", () => editor.refresh());
        }

        // ============================================
        // API 调用
        // ============================================
        async function api(url, options = {}) {
            try {
                const resp = await fetch(url, {
                    headers: { "Content-Type": "application/json" },
                    ...options
                });
                return await resp.json();
            } catch (e) {
                return { error: e.message };
            }
        }

        // ============================================
        // 加载题目列表
        // ============================================
        async function loadProblemList() {
            const data = await api("/api/questions");
            if (data.error) {
                document.querySelector(".no-results").textContent = "加载失败: " + data.error;
                return;
            }
            questions = data;
            const sel = document.getElementById("problemSelector");
            sel.innerHTML = '<option value="">-- 选择题目 --</option>';
            const categories = {};
            for (const q of questions) {
                if (!categories[q.category]) categories[q.category] = [];
                categories[q.category].push(q);
            }
            for (const [cat, qs] of Object.entries(categories)) {
                const group = document.createElement("optgroup");
                group.label = cat;
                for (const q of qs) {
                    const opt = document.createElement("option");
                    opt.value = q.id;
                    opt.textContent = `${q.title} (${q.difficulty})`;
                    group.appendChild(opt);
                }
                sel.appendChild(group);
            }
            // URL hash 的处理移到初始化最后的 Promise.all().then() 中统一执行
        }

        // ============================================
        // 搜索弹窗
        // ============================================
        function openSearchModal() {
            document.getElementById("searchModal").classList.add("open");
            document.getElementById("searchModalBody").innerHTML = '<div class="search-modal-hint">输入关键词搜索题目</div>';
            var inp = document.getElementById("searchModalInput");
            inp.value = "";
            inp.focus();
        }
        function closeSearchModal() {
            document.getElementById("searchModal").classList.remove("open");
        }
        function doSearch(keyword) {
            var body = document.getElementById("searchModalBody");
            keyword = keyword.trim().toLowerCase();
            if (!keyword) {
                body.innerHTML = '<div class="search-modal-hint">输入关键词搜索题目</div>';
                return;
            }
            if (!questions || !questions.length) {
                body.innerHTML = '<div class="search-no-match">暂无题目</div>';
                return;
            }
            var matched = [];
            for (var i = 0; i < questions.length; i++) {
                var q = questions[i];
                var txt = (q.title + " " + q.category + " " + q.difficulty).toLowerCase();
                if (txt.indexOf(keyword) !== -1) {
                    matched.push(q);
                }
            }
            if (matched.length === 0) {
                body.innerHTML = '<div class="search-no-match">未找到匹配的题目</div>';
                return;
            }
            var html = "";
            for (var j = 0; j < matched.length; j++) {
                var q = matched[j];
                var diffClass = "sm-diff-easy";
                if (q.difficulty === "中等") diffClass = "sm-diff-medium";
                else if (q.difficulty === "困难") diffClass = "sm-diff-hard";
                html += '<div class="search-modal-item" onclick="selectSearchResult(' + q.id + ')">' +
                    '<span class="sm-title"><span class="sm-id">#' + q.id + '</span>' + escHtml(q.title) + '</span>' +
                    '<span class="sm-cat">' + escHtml(q.category) + '</span>' +
                    '<span class="sm-diff ' + diffClass + '">' + escHtml(q.difficulty) + '</span>' +
                    '</div>';
            }
            body.innerHTML = html;
        }
        function selectSearchResult(id) {
            closeSearchModal();
            document.getElementById("problemSelector").value = id;
            loadQuestion(id);
        }

        // ============================================
        // 加载单个题目
        // ============================================
        var _loadingQuestion = null;
        async function loadQuestion(id) {
            if (!id) return;
            id = parseInt(id);
            if (_loadingQuestion === id) return;
            _loadingQuestion = id;
            window.location.hash = "#" + id;
            let q = questionCache[id];
            if (!q) {
                q = await api("/api/questions/" + id);
                if (q.error) {
                    document.getElementById("questionContent").innerHTML =
                        `<div class="no-results">${q.error}</div>`;
                    _loadingQuestion = null;
                    return;
                }
                questionCache[id] = q;
            }
            currentQuestion = q;
            questionPassed = localStorage.getItem("q_passed_" + id) === "1";
            // 设置代码（根据当前语言）
            const lang = document.querySelector(".lang-opt.active").dataset.lang;
            currentLang = lang;
            originalCode = getLanguageTemplate(q, lang);
            var saved = await getSavedCode(id, lang);
            editor.setValue(saved || originalCode);
            editor.refresh();
            editor.focus();

            // 渲染题目
            renderQuestion(q);

            // 切换 tab
            switchTab("desc", document.querySelector(".tab-bar .tab"));

            // 清空结果
            clearResults();

            // 启用按钮
            document.getElementById("runBtn").disabled = false;
            document.getElementById("submitBtn").disabled = false;

            // 保存最近题目
            localStorage.setItem("last_qid", id);

            // 更新导航按钮
            updateNavButtons(id);
            _loadingQuestion = null;
        }

        // ============================================
        // 上一题 / 下一题
        // ============================================
        function navigateQuestion(dir) {
            if (!questions.length || !currentQuestion) return;
            const ids = questions.map(q => q.id).sort((a, b) => a - b);
            const idx = ids.indexOf(currentQuestion.id);
            if (idx === -1) return;
            const target = idx + dir;
            if (target < 0 || target >= ids.length) return;
            document.getElementById("problemSelector").value = ids[target];
            loadQuestion(ids[target]);
        }
        function updateNavButtons(id) {
            if (!questions.length) return;
            const ids = questions.map(q => q.id).sort((a, b) => a - b);
            const idx = ids.indexOf(id);
            document.getElementById("prevBtn").disabled = idx <= 0;
            document.getElementById("nextBtn").disabled = idx >= ids.length - 1;
            document.getElementById("navIndex").textContent = `${idx + 1} / ${ids.length}`;
        }

        // ============================================
        // 查看提示
        // ============================================
        function toggleHint(btn) {
            const hintDiv = btn.parentElement.querySelector(".hint");
            if (!hintDiv) return;
            const hidden = hintDiv.style.display === "none";
            hintDiv.style.display = hidden ? "block" : "none";
            btn.textContent = hidden ? "💡 收起提示" : "💡 查看提示";
        }

        // ============================================
        // 渲染题目
        // ============================================
        function renderQuestion(q) {
            const badgeClass = {
                "简单": "badge-easy",
                "中等": "badge-medium",
                "困难": "badge-hard"
            }[q.difficulty] || "badge-easy";

            const html = `
                <div class="question-header">
                    <div class="q-title" style="display:flex;align-items:center;gap:12px;">
                        <span>${q.id}. ${q.title}</span>
                        <button onclick="deleteQuestion(${q.id})" style="margin-left:auto;font-size:12px;padding:2px 10px;border:1px solid #e57373;border-radius:4px;background:#fff;color:#c62828;cursor:pointer;">删除</button>
                    </div>
                    <div class="q-meta">
                        <span class="badge ${badgeClass}">${q.difficulty}</span>
                        <span style="color:#888;font-size:12px">${q.category}</span>
                    </div>
                </div>
                <div id="tabContent">
                    ${renderDescTab(q)}
                </div>
            `;
            document.getElementById("questionContent").innerHTML = html;
        }

        function renderDescTab(q) {
            return `
                <div class="q-section">
                    <h3>📝 题目描述</h3>
                    <p>${q.description}</p>
                </div>
                <div class="q-section">
                    <h3>📥 输入格式</h3>
                    <pre>${q.input_format}</pre>
                </div>
                <div class="q-section">
                    <h3>📤 输出格式</h3>
                    <pre>${q.output_format}</pre>
                </div>
                <div class="q-section">
                    <h3>📋 样例输入</h3>
                    <pre>${q.sample_input}</pre>
                </div>
                <div class="q-section">
                    <h3>📋 样例输出</h3>
                    <pre>${q.sample_output}</pre>
                </div>
                ${q.hint ? `<div class="q-section">
                    <button onclick="toggleHint(this)" style="font-size:13px;padding:6px 16px;border:1px solid #ffa000;border-radius:8px;background:#fff8e1;color:#e65100;cursor:pointer;font-weight:500;transition:all 0.12s;" onmouseover="this.style.background='#ffecb3'" onmouseout="this.style.background='#fff8e1'">💡 查看提示</button>
                    <div class="hint" style="display:none;margin-top:8px;">${q.hint}</div>
                </div>` : ''}
                <div class="q-section" style="color:#888;font-size:12px">
                    共 ${q.test_case_count} 个测试用例（包含样例）
                </div>
            `;
        }

        function renderCasesTab(q) {
            if (!q.test_cases || q.test_cases.length === 0) {
                return '<div class="no-results">暂无可见测试用例。</div>';
            }
            let html = `<div class="q-section"><h3>🧪 测试用例（共 ${q.test_case_count} 个）</h3></div>`;
            q.test_cases.forEach((tc, i) => {
                html += `
                    <div class="q-section" style="margin-bottom:12px">
                        <h3 style="font-size:13px">测试 #${i + 1}</h3>
                        <pre style="font-size:12px">输入：\n${tc.input.trim()}</pre>
                    </div>
                `;
            });
            return html;
        }

        // ============================================
        // Tab 切换
        // ============================================
        function switchTab(name, el) {
            if (!currentQuestion) return;
            document.querySelectorAll(".tab-bar .tab").forEach(t => t.classList.remove("active"));
            if (el) el.classList.add("active");

            const content = document.getElementById("tabContent");
            if (name === "desc") {
                content.innerHTML = renderDescTab(currentQuestion);
            } else {
                content.innerHTML = renderCasesTab(currentQuestion);
            }
        }

        // ============================================
        // 运行代码 — 流式评测
        // ============================================
        async function runCode(isSubmit) {
            if (!currentQuestion) return;
            const code = editor.getValue();
            const btnRun = document.getElementById("runBtn");
            const btnSubmit = document.getElementById("submitBtn");
            btnRun.disabled = true;
            btnRun.textContent = "⏳ 运行中...";
            btnSubmit.disabled = true;
            btnSubmit.textContent = "⏳ 提交中...";

            const panel = document.getElementById("resultPanel");
            panel.classList.add("open");
            document.getElementById("toggleIcon").textContent = "▲";
            document.getElementById("resultTitle").textContent = "⏳ 运行测试用例...";
            document.getElementById("resultStatus").innerHTML =
                '<span class="status-running">正在运行...</span>';
            document.getElementById("summaryBar").innerHTML = "";
            document.getElementById("resultBody").innerHTML =
                '<div class="no-results" style="display:flex;align-items:center;justify-content:center;gap:10px;"><span class="loading-spinner-inline"></span>正在评测...</div>';

            const start = Date.now();
            const endpoint = isSubmit ? "/api/submit-hidden-stream" : "/api/submit-stream";
            let allPassed = true;

            try {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        question_id: currentQuestion.id,
                        code: code,
                        language: currentLang
                    })
                });

                if (!response.ok) {
                    const err = await response.json();
                    var errMsg = err.error || "请求失败 (" + response.status + ")";
                    if (err.detail) errMsg += "\n" + err.detail;
                    throw new Error(errMsg);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";
                let resultCount = 0;
                let totalTests = 0;
                let passedCount = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    // 逐行解析 SSE（避免 \n\n 出现在 JSON 值中时误分割）
                    const lines = buf.split("\n");
                    buf = lines.pop() || "";  // 保留不完整的行

                    for (const line of lines) {
                        if (line === "" || line === "\r") {
                            // 空行 = 事件结束，等下一个 data: 再处理
                            continue;
                        }
                        if (line.startsWith("data: ")) {
                            let event;
                            try { event = JSON.parse(line.slice(6)); } catch (e) { continue; }

                            if (event.type === "start") {
                                totalTests = event.total;
                                document.getElementById("resultBody").innerHTML = "";
                                document.getElementById("summaryBar").innerHTML = `
                                    <span>总测试: <strong>${totalTests}</strong></span>
                                    <span>通过: <span class="num-pass">0</span></span>
                                    <span>失败: <span class="num-fail">0</span></span>
                                `;
                            } else if (event.type === "result") {
                                resultCount++;
                                if (!event.passed) allPassed = false;
                                else passedCount++;
                                appendStreamResult(event, isSubmit);
                                document.getElementById("summaryBar").innerHTML = `
                                    <span>总测试: <strong>${totalTests}</strong></span>
                                    <span>通过: <span class="num-pass">${passedCount}</span></span>
                                    <span>失败: <span class="num-fail">${resultCount - passedCount}</span></span>
                                    <span>耗时: ${Date.now() - start}ms</span>
                                `;
                                document.getElementById("resultStatus").innerHTML =
                                    `<span class="${allPassed ? 'status-accepted' : 'status-failed'}">${passedCount}/${totalTests} 通过</span>`;
                            } else if (event.type === "done") {
                                const elapsed = Date.now() - start;
                                const { passed_count, total, accepted, error } = event;

                                if (error) {
                                    document.getElementById("resultTitle").textContent = "⚠️ 评测异常";
                                    document.getElementById("resultStatus").innerHTML =
                                        `<span class="status-failed">${escHtml(error)}</span>`;
                                } else if (isSubmit && accepted) {
                                    document.getElementById("resultTitle").textContent = "✅ 提交通过！";
                                    document.getElementById("resultStatus").innerHTML =
                                        `<span class="status-accepted">Accepted (${elapsed}ms)</span>`;
                                    questionPassed = true;
                                    localStorage.setItem("q_passed_" + currentQuestion.id, "1");
                                    triggerFireworks();
                                } else if (isSubmit) {
                                    document.getElementById("resultTitle").textContent = "❌ 提交未通过";
                                    document.getElementById("resultStatus").innerHTML =
                                        `<span class="status-failed">${passed_count}/${total} 通过 (${elapsed}ms)</span>`;
                                } else if (accepted) {
                                    document.getElementById("resultTitle").textContent = "✅ 通过所有测试！";
                                    document.getElementById("resultStatus").innerHTML =
                                        `<span class="status-accepted">Accepted (${elapsed}ms)</span>`;
                                } else {
                                    document.getElementById("resultTitle").textContent = "❌ 未通过";
                                    document.getElementById("resultStatus").innerHTML =
                                        `<span class="status-failed">${passed_count}/${total} 通过 (${elapsed}ms)</span>`;
                                }

                                document.getElementById("summaryBar").innerHTML = `
                                    <span>总测试: <strong>${total}</strong></span>
                                    <span>通过: <span class="num-pass">${passed_count}</span></span>
                                    ${total - passed_count > 0 ? `<span>失败: <span class="num-fail">${total - passed_count}</span></span>` : ''}
                                    <span>耗时: ${elapsed}ms</span>
                                `;
                            } else if (event.type === "error") {
                                document.getElementById("resultTitle").textContent = "⚠️ 评测异常";
                                document.getElementById("resultStatus").innerHTML =
                                    `<span class="status-failed">${escHtml(event.message || "未知错误")}</span>`;
                            }
                        }
                    }
                }
            } catch (e) {
                document.getElementById("resultTitle").textContent = "❌ 评测失败";
                document.getElementById("resultStatus").innerHTML =
                    `<span class="status-failed">${escHtml(e.message)}</span>`;
                document.getElementById("resultBody").innerHTML =
                    `<div class="compile-error">${escHtml(e.message)}</div>`;
            }

            btnRun.disabled = false;
            btnRun.textContent = "▶ 运行测试";
            btnSubmit.disabled = false;
            btnSubmit.textContent = "📤 提交";
        }

        // ============================================
        // 流式追加单条测试结果
        // ============================================
        function appendStreamResult(event, isSubmit) {
            const body = document.getElementById("resultBody");
            const firstNew = body.querySelector(".no-results");
            if (firstNew) firstNew.remove();

            if (isSubmit) {
                const cls = event.passed ? "tc-pass" : "tc-fail";
                const txt = event.passed ? "✅ AC" : "❌ 错误";
                const div = document.createElement("div");
                div.className = "test-case";
                div.innerHTML = `
                    <div class="tc-header ${cls}">
                        <span>隐藏测试 #${event.test_id}</span>
                        <span>${txt} (${event.time || 0}s)</span>
                    </div>
                `;
                body.appendChild(div);
            } else {
                let cls = "tc-pass", txt = "✅ 通过";
                if (event.error && !event.passed) { cls = "tc-error"; txt = "⚠️ 错误"; }
                else if (!event.passed) { cls = "tc-fail"; txt = "❌ 未通过"; }

                const div = document.createElement("div");
                div.className = "test-case";
                div.innerHTML = `
                    <div class="tc-header ${cls}">
                        <span>测试 #${event.test_id}</span>
                        <span>${txt} (${event.time || 0}s)</span>
                    </div>
                    <div class="tc-body">
                        <div class="label">输入：</div>
                        <pre class="stdin-text">${escHtml(event.input || "(空)")}</pre>
                        ${!event.passed ? `
                            <div class="label diff-expected">期望输出：</div>
                            <pre class="diff-expected">${escHtml(event.expected || "")}</pre>
                            <div class="label diff-actual">实际输出：</div>
                            <pre class="diff-actual">${escHtml(event.actual || "(无输出)")}</pre>
                        ` : `
                            <div class="label">输出：</div>
                            <pre class="stdout-text">${escHtml(event.actual || "(空)")}</pre>
                        `}
                        ${event.error ? `<pre class="compile-error">${escHtml(event.error)}</pre>` : ''}
                    </div>
                `;
                body.appendChild(div);
            }

            // 滚动结果面板到底部
            const panel = document.getElementById("resultPanel");
            panel.scrollTop = panel.scrollHeight;
        }


        // ============================================
        // 重置代码
        // ============================================
        function toggleEditorBg() {
            const panel = document.getElementById("rightPanel");
            const isLight = panel.classList.toggle("editor-light");
            const btn = document.getElementById("bgToggleBtn");
            btn.textContent = isLight ? "🌙" : "☀️";
            localStorage.setItem("editor_bg_light", isLight ? "1" : "0");
            setTimeout(() => editor.refresh(), 50);
        }
        // 初始化编辑器背景
        function initEditorBg() {
            if (localStorage.getItem("editor_bg_light") === "1") {
                const panel = document.getElementById("rightPanel");
                panel.classList.add("editor-light");
                document.getElementById("bgToggleBtn").textContent = "🌙";
            }
        }

        function saveCode() {
            if (!currentQuestion) return;
            var qid = currentQuestion.id;
            var lang = currentLang;
            var code = editor.getValue();
            // 保存到服务端
            fetch("/api/code/save", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({question_id: qid, language: lang, code: code})
            }).catch(function(){});
            // 更新本地缓存
            if (!savedCodeCache[qid]) savedCodeCache[qid] = {};
            savedCodeCache[qid][lang] = code;
            var btn = document.getElementById("saveBtn");
            var orig = btn.innerHTML;
            btn.innerHTML = "✅ 已保存";
            btn.disabled = true;
            setTimeout(function() {
                btn.innerHTML = orig;
                btn.disabled = false;
            }, 1500);
        }

        async function getSavedCode(qid, lang) {
            // 1. 内存缓存（页面加载时 load-all 填充）
            if (savedCodeCache[qid] && savedCodeCache[qid][lang] !== undefined) {
                return savedCodeCache[qid][lang];
            }
            // 2. 直接从服务端拉取（绕过 localStorage）
            try {
                var resp = await fetch("/api/code/load/" + qid);
                var data = await resp.json();
                if (data && data[lang]) {
                    if (!savedCodeCache[qid]) savedCodeCache[qid] = {};
                    savedCodeCache[qid][lang] = data[lang];
                    return data[lang];
                }
            } catch(e) {}
            return null;
        }

        function clearSavedCode(qid, lang) {
            // 清内存缓存
            if (savedCodeCache[qid]) delete savedCodeCache[qid][lang];
            // 清服务端（写入空串覆盖）
            fetch("/api/code/save", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({question_id: qid, language: lang, code: ""})
            }).catch(function(){});
        }

        function resetCode() {
            if (!currentQuestion) return;
            if (originalCode) {
                clearSavedCode(currentQuestion.id, currentLang);
                editor.setValue(originalCode);
                editor.refresh();
            }
        }

        // ============================================
        // 清空结果
        // ============================================
        function clearResults() {
            const panel = document.getElementById("resultPanel");
            panel.classList.remove("open");
            document.getElementById("resultTitle").textContent = "评测结果";
            document.getElementById("resultStatus").innerHTML = "";
            document.getElementById("summaryBar").innerHTML = "";
            document.getElementById("resultBody").innerHTML = "";
        }

        function toggleResults() {
            const panel = document.getElementById("resultPanel");
            const icon = document.getElementById("toggleIcon");
            const isOpen = panel.classList.toggle("open");
            icon.textContent = isOpen ? "▲" : "▼";
        }
        // ============================================
        // 删除题目
        // ============================================
        async function deleteQuestion(id) {
            if (!confirm(`确定要删除题目 #${id} 吗？删除后无法恢复。`)) return;
            const resp = await api("/api/questions/" + id, { method: "DELETE" });
            if (resp.error) {
                alert("删除失败: " + resp.error);
                return;
            }
            alert(resp.message);
            // 从缓存中移除
            delete questionCache[id];
            // 从列表中移除
            const sel = document.getElementById("problemSelector");
            const opt = sel.querySelector(`option[value="${id}"]`);
            if (opt) opt.remove();
            // 如果当前显示的就是被删的题，重置界面
            if (currentQuestion && currentQuestion.id === id) {
                currentQuestion = null;
                document.getElementById("questionContent").innerHTML =
                    '<div class="no-results">题目已删除，请选择其他题目。</div>';
                clearResults();
                document.getElementById("runBtn").disabled = true;
                editor.setValue("");
            }
        }

        // ============================================
        // 上传 Word 题目
        // ============================================
        function toggleUploadModal() {
            document.getElementById("uploadModal").classList.toggle("open");
        }
        function closeUploadModal() {
            document.getElementById("uploadModal").classList.remove("open");
        }
        async function uploadQuestionDocx(input) {
            var file = input.files[0];
            if (!file) return;
            var formData = new FormData();
            formData.append("file", file);
            showLoading("正在解析 Word 文档...");
            try {
                var resp = await fetch("/api/questions/upload-docx", {
                    method: "POST",
                    body: formData,
                });
                var data = await resp.json();
                if (data.error) {
                    alert("上传失败: " + data.error);
                } else {
                    alert(data.message);
                    closeUploadModal();
                    await loadProblemList();
                }
            } catch (e) {
                alert("上传失败: " + e.message);
            }
            hideLoading();
            input.value = "";
        }

        // ============================================
        // 批量删除题目
        // ============================================
        function openBatchDelete() {
            var over = document.getElementById("batchDelModal");
            var list = document.getElementById("batchDelList");
            if (!questions || !questions.length) {
                list.innerHTML = '<div class="batch-del-empty">暂无题目</div>';
            } else {
                var html = "";
                for (var i = 0; i < questions.length; i++) {
                    var q = questions[i];
                    html += '<label class="batch-del-item">' +
                        '<input type="checkbox" class="del-checkbox" value="' + q.id + '" onchange="updateBatchDelCount()" />' +
                        '<span class="del-info"><span class="del-id">#' + q.id + '</span>' + escHtml(q.title) + '<span class="del-cat">' + escHtml(q.category) + '</span></span>' +
                        '</label>';
                }
                html += '<label class="batch-del-item" style="border-bottom:none;color:#888;font-size:12px;justify-content:center;">' +
                    '<input type="checkbox" onchange="toggleBatchDelAll(this)" style="accent-color:#e53935;" /> 全选</label>';
                list.innerHTML = html;
            }
            document.getElementById("batchDelCount").textContent = "已选 0 道";
            document.getElementById("batchDelConfirmBtn").disabled = true;
            over.classList.add("open");
        }
        function closeBatchDelete() {
            document.getElementById("batchDelModal").classList.remove("open");
        }
        function updateBatchDelCount() {
            var checks = document.querySelectorAll(".del-checkbox:checked");
            var count = checks.length;
            document.getElementById("batchDelCount").textContent = "已选 " + count + " 道";
            document.getElementById("batchDelConfirmBtn").disabled = count === 0;
        }
        function toggleBatchDelAll(master) {
            var checks = document.querySelectorAll(".del-checkbox");
            for (var i = 0; i < checks.length; i++) {
                checks[i].checked = master.checked;
            }
            updateBatchDelCount();
        }
        async function confirmBatchDelete() {
            var checks = document.querySelectorAll(".del-checkbox:checked");
            var ids = [];
            for (var i = 0; i < checks.length; i++) {
                ids.push(parseInt(checks[i].value));
            }
            if (ids.length === 0) return;
            if (!confirm("确定要删除 " + ids.length + " 道题目吗？此操作无法撤销。")) return;
            var btn = document.getElementById("batchDelConfirmBtn");
            btn.disabled = true;
            btn.textContent = "删除中...";
            try {
                var resp = await api("/api/questions/batch-delete", {
                    method: "POST",
                    body: JSON.stringify({ ids: ids })
                });
                if (resp.error) {
                    alert("删除失败: " + resp.error);
                    btn.disabled = false;
                    btn.textContent = "删除所选";
                    return;
                }
                alert(resp.message);
                closeBatchDelete();
                for (var j = 0; j < ids.length; j++) {
                    delete questionCache[ids[j]];
                }
                if (currentQuestion && ids.indexOf(currentQuestion.id) !== -1) {
                    currentQuestion = null;
                    document.getElementById("questionContent").innerHTML =
                        '<div class="no-results">题目已删除，请选择其他题目。</div>';
                    clearResults();
                    document.getElementById("runBtn").disabled = true;
                    editor.setValue("");
                }
                await loadProblemList();
            } catch (e) {
                alert("删除失败: " + e.message);
                btn.disabled = false;
                btn.textContent = "删除所选";
            }
        }

        // ============================================
        // 切换语言
        // ============================================
        function getLanguageTemplate(q, lang) {
            if (lang === "cpp") return (q && q.template_code_cpp) ? q.template_code_cpp : TEMPLATE_CPP;
            return q ? q.template_code : "";
        }
        async function switchLanguage(lang) {
            currentLang = lang;
            document.querySelectorAll(".lang-opt").forEach(el => {
                el.classList.toggle("active", el.dataset.lang === lang);
            });
            editor.setOption("mode", lang === "cpp" ? "text/x-c++src" : "python");
            if (currentQuestion) {
                originalCode = getLanguageTemplate(currentQuestion, lang);
                var saved = await getSavedCode(currentQuestion.id, lang);
                editor.setValue(saved || originalCode);
            }
            editor.refresh();
        }

        // ============================================
        // 模式切换
        // ============================================
        let currentMode = "practice";

        function switchMode(mode, el) {
            currentMode = mode;
            document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
            if (el) el.classList.add("active");

            if (mode === "aigen") {
                document.getElementById("aigenOverlay").classList.add("open");
                document.querySelector(".app-body").style.display = "none";
                var noKeyOverlay = document.getElementById("aigenNoKeyOverlay");
                var bodyInner = document.getElementById("aigenBodyInner");
                if (!isKeyVerified()) {
                    noKeyOverlay.style.display = "flex";
                    bodyInner.style.display = "none";
                } else {
                    noKeyOverlay.style.display = "none";
                    bodyInner.style.display = "block";
                    setTimeout(() => document.getElementById("aigenInput").focus(), 100);
                }
                return;
            }

            document.getElementById("aigenOverlay").classList.remove("open");
            document.querySelector(".app-body").style.display = "flex";
            document.getElementById("practicePanel").classList.remove("hide");

            if (editor) {
                setTimeout(() => editor.refresh(), 50);
            }

        }

        function closeAIGen() {
            switchMode(currentMode === "aigen" ? "practice" : currentMode,
                document.querySelector(".nav-tab:first-child"));
        }

        function showLoading(msg) {
            var overlay = document.getElementById("loadingOverlay");
            overlay.classList.add("show");
            overlay.innerHTML = '<div style="text-align:center;"><div class="loading-spinner" style="margin:0 auto 12px;"></div><div style="color:#fff;font-size:14px;">' + escHtml(msg || '处理中...') + '</div></div>';
        }
        function hideLoading() {
            document.getElementById("loadingOverlay").classList.remove("show");
        }

        function escHtml(s) {
            if (!s) return '';
            return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        // ============================================
        // AI 出题
        // ============================================
        // 输入框自动伸缩
function autoResizeInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

let aigenQuestionId = null;

        async function generateQuestion() {
            if (!requireAIKey()) return;
            const input = document.getElementById("aigenInput");
            const desc = input.value.trim();
            if (!desc) { alert("请先描述你要创建的题目"); return; }

            const btn = document.getElementById("aigenBtn");
            const status = document.getElementById("aigenStatus");
            const error = document.getElementById("aigenError");
            const result = document.getElementById("aigenResult");

            error.classList.remove("show");
            result.classList.remove("show");
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';
            status.textContent = "AI 正在思考...";
            showLoading("AI 正在生成题目...");

            try {
                const resp = await fetch("/api/ai/generate-question", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({
                        description: desc,
                        api_key: getAIKey()
                    })
                });
                const data = await resp.json();

                if (data.error) {
                    error.textContent = data.error;
                    error.classList.add("show");
                    status.textContent = "";
                    btn.disabled = false;
                    btn.innerHTML = '发送';
                    hideLoading();
                    return;
                }

                aigenQuestionId = data.id;
                const q = data.question;

                const diffClass = q.difficulty === '简单' ? 'aigen-pill-easy' : q.difficulty === '中等' ? 'aigen-pill-medium' : 'aigen-pill-hard';
                document.getElementById("aigenResultTitle").textContent =
                    `#${data.id} ${q.title}`;
                document.getElementById("aigenResultMeta").innerHTML = `
                    <span class="aigen-pill ${diffClass}">${q.difficulty}</span>
                    <span>${q.category}</span>
                    <span>${q.test_case_count} 个测试用例</span>
                `;
                document.getElementById("aigenResultDetail").innerHTML =
                    `<strong>标题：</strong> ${q.title}<br>` +
                    `<strong>难度：</strong> ${q.difficulty}<br>` +
                    `<strong>分类：</strong> ${q.category}<br>` +
                    `<strong>测试用例：</strong> ${q.test_case_count} 个`;
                result.classList.add("show");
                status.textContent = "✅ 题目创建成功！";
                btn.disabled = false;
                btn.innerHTML = '发送';
                hideLoading();

                await loadProblemList();
                document.getElementById("problemSelector").value = data.id;
            } catch (e) {
                error.textContent = "请求失败: " + e.message;
                error.classList.add("show");
                status.textContent = "";
                btn.disabled = false;
                btn.innerHTML = '发送';
                hideLoading();
            }
        }

        function goToQuestion() {
            if (aigenQuestionId) {
                switchMode("practice", document.querySelector(".nav-tab:first-child"));
                document.getElementById("problemSelector").value = aigenQuestionId;
                loadQuestion(aigenQuestionId);
            }
        }

        function resetAIGen() {
            document.getElementById("aigenInput").value = "";
            document.getElementById("aigenResult").classList.remove("show");
            document.getElementById("aigenError").classList.remove("show");
            document.getElementById("aigenStatus").textContent = "";
            aigenQuestionId = null;
            document.getElementById("aigenInput").focus();
        }

        function getAIKey() { return localStorage.getItem("deepseek_api_key") || ""; }
        function isKeyVerified() {
            return getAIKey().length >= 10 && localStorage.getItem("deepseek_api_key_verified") === "1";
        }

        // 检查 API Key 是否已通过 API 验证，未通过则弹窗提示去设置
        function requireAIKey() {
            if (isKeyVerified()) return true;
            // 有 key 但未验证 → 弹窗提示重新保存（会触发 API 验证）
            // 弹窗提示去设置
            var overlay = document.getElementById("settingsOverlay");
            overlay.classList.add("open");
            document.getElementById("settingsApiKey").value = "";
            document.getElementById("settingsApiKey").focus();
            document.getElementById("settingsStatus").innerHTML =
                '<span style="color:#e65100;">⚠️ 请先配置有效的 API Key 后再使用 AI 功能</span>';
            return false;
        }

        // ============================================
        // AI 助手聊天（可拖动）
        // ============================================
        var aiChatHistory = [];
        var _chatDragging = false;
        var _chatDragOffsetX = 0;
        var _chatDragOffsetY = 0;

        function toggleAIChat() {
            var panel = document.getElementById("aiChatPanel");
            var fab = document.getElementById("aiChatFab");
            var isOpen = panel.classList.toggle("open");
            fab.style.display = isOpen ? "none" : "flex";
            if (isOpen) {
                // 首次打开时设置默认位置和尺寸
                if (!panel.style.left && !panel.style.right) {
                    panel.style.right = "24px";
                    panel.style.bottom = "84px";
                }
                if (!panel.style.width && !panel.style.height) {
                    panel.style.width = "386px";
                    panel.style.height = "520px";
                }
                setTimeout(function() {
                    document.getElementById("aiChatInput").focus();
                    var msgs = document.getElementById("aiChatMessages");
                    msgs.scrollTop = msgs.scrollHeight;
                }, 100);
            }
        }

        function initChatDrag() {
            var head = document.querySelector(".ai-chat-head");
            var panel = document.getElementById("aiChatPanel");
            if (!head || !panel) return;

            head.addEventListener("mousedown", function(e) {
                if (e.target.closest(".ai-chat-close")) return;
                _chatDragging = true;
                var rect = panel.getBoundingClientRect();
                _chatDragOffsetX = e.clientX - rect.left;
                _chatDragOffsetY = e.clientY - rect.top;
                panel.style.left = rect.left + "px";
                panel.style.top = rect.top + "px";
                panel.style.right = "auto";
                panel.style.bottom = "auto";
                panel.style.transition = "none";
            });

            document.addEventListener("mousemove", function(e) {
                if (!_chatDragging) return;
                var left = e.clientX - _chatDragOffsetX;
                var top = e.clientY - _chatDragOffsetY;
                // 限制不能完全拖出屏幕
                var maxX = window.innerWidth - 60;
                var maxY = window.innerHeight - 60;
                left = Math.max(0, Math.min(left, maxX));
                top = Math.max(0, Math.min(top, maxY));
                panel.style.left = left + "px";
                panel.style.top = top + "px";
            });

            document.addEventListener("mouseup", function() {
                if (_chatDragging) {
                    _chatDragging = false;
                    panel.style.transition = "";
                }
            });
        }

        function initChatResize() {
            var handle = document.getElementById("aiChatResizeHandle");
            var panel = document.getElementById("aiChatPanel");
            if (!handle || !panel) return;
            var _resizing = false;
            var _startX, _startY, _startW, _startH;

            handle.addEventListener("mousedown", function(e) {
                e.preventDefault();
                e.stopPropagation();
                _resizing = true;
                _startX = e.clientX;
                _startY = e.clientY;
                _startW = panel.offsetWidth;
                _startH = panel.offsetHeight;
                // 切换到固定定位（清除 auto）
                var rect = panel.getBoundingClientRect();
                panel.style.left = rect.left + "px";
                panel.style.top = rect.top + "px";
                panel.style.right = "auto";
                panel.style.bottom = "auto";
                panel.style.transition = "none";
            });

            document.addEventListener("mousemove", function(e) {
                if (!_resizing) return;
                var dw = e.clientX - _startX;
                var dh = e.clientY - _startY;
                var newW = Math.max(280, Math.min(700, _startW + dw));
                var newH = Math.max(360, Math.min(800, _startH + dh));
                panel.style.width = newW + "px";
                panel.style.height = newH + "px";
            });

            document.addEventListener("mouseup", function() {
                if (_resizing) {
                    _resizing = false;
                    panel.style.transition = "";
                }
            });
        }

        function initFabDrag() {
            var fab = document.getElementById("aiChatFab");
            if (!fab) return;
            var _fabDragging = false;
            var _fabMoved = false;
            var _fabOffX, _fabOffY, _fabStartX, _fabStartY;

            fab.addEventListener("mousedown", function(e) {
                e.preventDefault();
                _fabDragging = true;
                _fabMoved = false;
                var rect = fab.getBoundingClientRect();
                _fabOffX = e.clientX - rect.left;
                _fabOffY = e.clientY - rect.top;
                _fabStartX = e.clientX;
                _fabStartY = e.clientY;
                // 从 bottom/right 切换到 top/left 固定
                fab.style.left = rect.left + "px";
                fab.style.top = rect.top + "px";
                fab.style.right = "auto";
                fab.style.bottom = "auto";
                fab.style.transition = "none";
                fab.style.cursor = "grabbing";
                document.body.style.userSelect = "none";
            });

            document.addEventListener("mousemove", function(e) {
                if (!_fabDragging) return;
                if (Math.abs(e.clientX - _fabStartX) > 5 || Math.abs(e.clientY - _fabStartY) > 5) {
                    _fabMoved = true;
                }
                var left = e.clientX - _fabOffX;
                var top = e.clientY - _fabOffY;
                var maxX = window.innerWidth - 60;
                var maxY = window.innerHeight - 60;
                left = Math.max(0, Math.min(left, maxX));
                top = Math.max(0, Math.min(top, maxY));
                fab.style.left = left + "px";
                fab.style.top = top + "px";
            });

            document.addEventListener("mouseup", function() {
                if (_fabDragging) {
                    _fabDragging = false;
                    fab.style.transition = "";
                    fab.style.cursor = "";
                    document.body.style.userSelect = "";
                }
            });

            fab.addEventListener("click", function(e) {
                if (_fabMoved) {
                    e.stopPropagation();
                    return;
                }
                toggleAIChat();
            });
        }

        function appendChatMessage(role, content) {
            var container = document.getElementById("aiChatMessages");
            var div = document.createElement("div");
            div.className = "ai-chat-msg ai-chat-msg-" + (role === "user" ? "user" : "bot");
            var inner = document.createElement("div");
            inner.className = "ai-chat-msg-content";
            inner.textContent = content;
            div.appendChild(inner);
            container.appendChild(div);
            container.scrollTop = container.scrollHeight;
        }

        async function sendAIChatMessage() {
            if (!requireAIKey()) return;
            var input = document.getElementById("aiChatInput");
            var text = input.value.trim();
            if (!text) return;

            var btn = document.getElementById("aiChatSendBtn");
            btn.disabled = true;
            input.disabled = true;

            appendChatMessage("user", text);
            input.value = "";
            input.style.height = "auto";

            // 显示打字中
            var container = document.getElementById("aiChatMessages");
            var typingDiv = document.createElement("div");
            typingDiv.className = "ai-chat-msg ai-chat-msg-bot ai-chat-typing";
            var typingInner = document.createElement("div");
            typingInner.className = "ai-chat-msg-content";
            for (var d = 0; d < 3; d++) {
                var dot = document.createElement("span");
                dot.className = "ai-chat-dot";
                typingInner.appendChild(dot);
            }
            typingDiv.appendChild(typingInner);
            container.appendChild(typingDiv);
            container.scrollTop = container.scrollHeight;

            aiChatHistory.push({role: "user", content: text});
            try {
                var resp = await fetch("/api/ai/chat", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({
                        api_key: getAIKey(),
                        messages: aiChatHistory,
                    }),
                });
                var data = await resp.json();
                // 移除打字中
                typingDiv.remove();
                if (data.error) {
                    appendChatMessage("bot", "⚠️ " + data.error);
                } else {
                    var reply = data.reply || "(无回复)";
                    appendChatMessage("bot", reply);
                    aiChatHistory.push({role: "assistant", content: reply});
                }
            } catch (e) {
                typingDiv.remove();
                appendChatMessage("bot", "⚠️ 网络错误: " + e.message);
            }

            btn.disabled = false;
            input.disabled = false;
            input.focus();
        }

        // ============================================
        // 字体大小设置
        // ============================================
        function getEditorFontSize() { return parseInt(localStorage.getItem("editor_font_size")) || 14; }

        function applyEditorFontSize(size) {
            var wrapper = document.querySelector(".editor-wrapper .CodeMirror");
            if (wrapper) wrapper.style.fontSize = size + "px";
            // 保存到 CSS 变量供新创建的元素使用
            document.documentElement.style.setProperty("--editor-font-size", size + "px");
        }

        function switchSettingsPane(paneId, el) {
            document.querySelectorAll(".settings-sidebar-item").forEach(function(i) { i.classList.remove("active"); });
            document.querySelectorAll(".settings-pane").forEach(function(p) { p.classList.remove("active"); });
            if (el) el.classList.add("active");
            document.getElementById(paneId).classList.add("active");
        }

        function previewFontSize(size) {
            document.getElementById("settingsFontSizeLabel").textContent = size;
            applyEditorFontSize(size);
        }

        function toggleSettings() {
            var overlay = document.getElementById("settingsOverlay");
            overlay.classList.toggle("open");
            if (overlay.classList.contains("open")) {
                document.getElementById("settingsApiKey").value = getAIKey();
                document.getElementById("settingsApiKey").focus();
                document.getElementById("settingsStatus").textContent = "";
                // 加载字体大小
                var cur = getEditorFontSize();
                document.getElementById("settingsFontSize").value = cur;
                document.getElementById("settingsFontSizeLabel").textContent = cur;
                // 检查编译器状态
                checkCompilerStatus();
                // 加载保存的编译器路径
                fetch("/api/settings").then(function(r){return r.json()}).then(function(data){
                    if (data.compiler_path) {
                        document.getElementById("settingsCompilerPath").value = data.compiler_path;
                    }
                }).catch(function(){});
            }
        }
        function closeSettings() {
            document.getElementById("settingsOverlay").classList.remove("open");
            var hasValidKey = isKeyVerified();
            if (currentMode === "aigen") {
                document.getElementById("aigenNoKeyOverlay").style.display = hasValidKey ? "none" : "flex";
                document.getElementById("aigenBodyInner").style.display = hasValidKey ? "block" : "none";
            }
        }
        function quitApp() {
            if (confirm("确定要退出程序吗？")) {
                fetch("/api/quit", { method: "POST" }).catch(function(){}).then(function(){
                    window.close();
                });
            }
        }
        // 定时心跳：浏览器关闭后约 5 秒自动退出进程
        setInterval(function() {
            fetch("/api/heartbeat", { method: "GET" }).catch(function(){});
        }, 2000);
        async function saveSettingsKey() {
            var key = document.getElementById("settingsApiKey").value.trim();
            var status = document.getElementById("settingsStatus");
            // 字体大小无脑保存
            var fontSize = parseInt(document.getElementById("settingsFontSize").value) || 14;
            localStorage.setItem("editor_font_size", fontSize);
            applyEditorFontSize(fontSize);
            var editorStatus = document.getElementById("settingsEditorStatus");
            if (editorStatus) { editorStatus.textContent = "✅ 字体大小已设为 " + fontSize + "px"; editorStatus.style.color = "#2e7d32"; }

            if (!key) {
                localStorage.removeItem("deepseek_api_key");
                localStorage.removeItem("deepseek_api_key_verified");
                // 同时清除服务端保存的 key
                fetch("/api/settings", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({api_key:""})}).catch(function(){});
                status.textContent = "✅ 已清除 API Key";
                status.style.color = "#888";
                setTimeout(closeSettings, 1000);
                return;
            }
            if (key.length < 10) {
                status.innerHTML = '<span style="color:#e65100;">⚠️ API Key 太短，格式不对。DeepSeek key 以 sk- 开头</span>';
                return;
            }

            // 实际调 API 验证
            status.innerHTML = '<span style="color:#ffa726;">⏳ 正在验证 API Key...</span>';
            try {
                var resp = await fetch("/api/ai/chat", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({
                        api_key: key,
                        messages: [{"role": "user", "content": "ping"}],
                    }),
                });
                var data = await resp.json();
                if (data.error) {
                    status.innerHTML = '<span style="color:#c62828;">❌ 验证失败: ' + escHtml(data.error) + '</span>';
                    return;
                }
                // 同时保存到服务端和浏览器（浏览器作为缓存）
                localStorage.setItem("deepseek_api_key", key);
                localStorage.setItem("deepseek_api_key_verified", "1");
                fetch("/api/settings", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({api_key: key})}).catch(function(){});
                status.innerHTML = '<span style="color:#2e7d32;">✅ 验证通过！Key 已保存</span>';
                setTimeout(closeSettings, 1000);
            } catch (e) {
                status.innerHTML = '<span style="color:#c62828;">❌ 网络错误: ' + escHtml(e.message) + '</span>';
            }
        }
        async function checkCompilerStatus() {
            var display = document.getElementById("compilerStatusDisplay");
            try {
                var resp = await fetch("/api/compiler-status");
                var data = await resp.json();
                if (data.found) {
                    display.innerHTML = '<span style="color:#2e7d32;">✅ 已检测到编译器</span><br/><small style="color:#888;">路径: ' + escHtml(data.path) + '<br/>版本: ' + escHtml(data.version) + '</small>';
                } else {
                    display.innerHTML = '<span style="color:#c62828;">❌ 未找到编译器</span><br/><small style="color:#888;">' + escHtml(data.error) + '</small>';
                }
            } catch (e) {
                display.innerHTML = '<span style="color:#c62828;">❌ 检测失败: ' + escHtml(e.message) + '</span>';
            }
        }
        async function saveCompilerPath() {
            var path = document.getElementById("settingsCompilerPath").value.trim();
            var status = document.getElementById("compilerSettingsStatus");
            try {
                var resp = await fetch("/api/settings", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({compiler_path: path}),
                });
                var data = await resp.json();
                if (data.ok) {
                    status.innerHTML = '<span style="color:#2e7d32;">✅ 已保存</span>';
                    checkCompilerStatus();
                } else {
                    status.innerHTML = '<span style="color:#c62828;">❌ 保存失败</span>';
                }
            } catch (e) {
                status.innerHTML = '<span style="color:#c62828;">❌ 网络错误: ' + escHtml(e.message) + '</span>';
            }
        }
        // 点击 Esc 关闭设置
        document.addEventListener("keydown", function(e) {
            if (e.key === "Escape" && document.getElementById("settingsOverlay").classList.contains("open")) {
                closeSettings();
            }
            if (e.key === "Escape" && document.getElementById("uploadModal").classList.contains("open")) {
                closeUploadModal();
            }
            if (e.key === "Escape" && document.getElementById("batchDelModal").classList.contains("open")) {
                closeBatchDelete();
            }
            if (e.key === "Escape" && document.getElementById("searchModal").classList.contains("open")) {
                closeSearchModal();
            }
        });

        // ============================================
        // 键盘快捷键 Ctrl+Enter -> 运行
        // ============================================
        document.addEventListener("keydown", function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                if (!document.getElementById("runBtn").disabled) {
                    runCode();
                }
            }
        });

        // ============================================
        // 可拖拽分隔条
        // ============================================
        const divider = document.getElementById("divider");
        const leftPanel = document.getElementById("leftPanel");
        const rightPanel = document.getElementById("rightPanel");
        let isDragging = false;

        divider.addEventListener("mousedown", function (e) {
            isDragging = true;
            divider.classList.add("active");
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        });

        document.addEventListener("mousemove", function (e) {
            if (!isDragging) return;
            const totalW = divider.parentElement.clientWidth;
            let leftW = e.clientX - leftPanel.getBoundingClientRect().left;
            // 限制：最小 320px，最大不超过总宽减 500px（给编辑器留空间）
            const minW = 320;
            const maxW = totalW - 500;
            if (leftW < minW) leftW = minW;
            if (leftW > maxW) leftW = maxW;
            leftPanel.style.width = leftW + "px";
            leftPanel.style.flex = "none";
            if (editor) editor.refresh();
        });

        document.addEventListener("mouseup", function () {
            if (isDragging) {
                isDragging = false;
                divider.classList.remove("active");
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                if (editor) editor.refresh();
            }
        });

        // ============================================
        // 初始化
        // ============================================


        function initLanguageState() {
            // 确保 currentLang 与 DOM 中 active 语言标签一致
            var activeLang = document.querySelector(".lang-opt.active");
            if (activeLang) {
                currentLang = activeLang.dataset.lang;
            } else {
                // 兜底：默认 C++
                currentLang = "cpp";
                var firstCpp = document.querySelector('.lang-opt[data-lang="cpp"]');
                if (firstCpp) firstCpp.classList.add("active");
            }
        }

        window.onload = function() {
            initLanguageState();
            initEditor();
            initEditorBg();
            initChatDrag();
            initChatResize();
            initFabDrag();

            // 并行加载：题目列表 + 已保存代码缓存
            Promise.all([
                loadProblemList(),
                fetch("/api/code/load-all").then(function(r){return r.json()}).then(function(data){
                    savedCodeCache = data || {};
                }).catch(function(){ savedCodeCache = {}; })
            ]).then(function() {
                // === 加载初始题目（仅一次，避免 hash 和 last_qid 竞争）===
                var targetId = null;
                // 1. URL hash 优先（来自分享链接）
                if (window.location.hash) {
                    targetId = parseInt(window.location.hash.replace("#", ""));
                }
                // 2. 其次恢复上次浏览的题目
                if (!targetId) {
                    var last = localStorage.getItem("last_qid");
                    if (last) targetId = parseInt(last);
                }
                if (targetId && document.querySelector('#problemSelector option[value="' + targetId + '"]')) {
                    document.getElementById("problemSelector").value = targetId;
                    loadQuestion(targetId);
                }
            });
        };

        // ============================================
        // 烟花 + 奖励动画
        // ============================================
        function triggerFireworks() {
            var popup = document.getElementById("rewardPopup");
            popup.classList.add("show");
            setTimeout(function() { popup.classList.add("animate"); }, 300);
            setTimeout(function() { popup.classList.remove("show"); popup.classList.remove("animate"); }, 4000);

            var canvas = document.getElementById("fireworksCanvas");
            var ctx = canvas.getContext("2d");
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            var particles = [];
            var colors = ["#ff6b6b","#ffd43b","#69db7c","#74c0fc","#b197fc","#f783ac","#ffa94d","#63e6be"];

            function createBurst(x, y) {
                for (var i = 0; i < 60; i++) {
                    var angle = Math.random() * Math.PI * 2;
                    var speed = Math.random() * 6 + 2;
                    particles.push({
                        x: x, y: y,
                        vx: Math.cos(angle) * speed,
                        vy: Math.sin(angle) * speed,
                        life: 1,
                        decay: Math.random() * 0.02 + 0.01,
                        size: Math.random() * 4 + 2,
                        color: colors[Math.floor(Math.random() * colors.length)]
                    });
                }
            }

            createBurst(canvas.width * 0.3, canvas.height * 0.3);
            createBurst(canvas.width * 0.7, canvas.height * 0.25);
            setTimeout(function() { createBurst(canvas.width * 0.5, canvas.height * 0.35); }, 400);
            setTimeout(function() { createBurst(canvas.width * 0.2, canvas.height * 0.5); }, 700);
            setTimeout(function() { createBurst(canvas.width * 0.8, canvas.height * 0.4); }, 1000);

            function animate() {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                for (var i = particles.length - 1; i >= 0; i--) {
                    var p = particles[i];
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.05;
                    p.life -= p.decay;
                    if (p.life <= 0) { particles.splice(i, 1); continue; }
                    ctx.globalAlpha = p.life;
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                if (particles.length > 0) { requestAnimationFrame(animate); }
                else { ctx.clearRect(0, 0, canvas.width, canvas.height); }
            }
            animate();
        }


        // 关闭浏览器时通知服务器退出
        window.addEventListener("beforeunload", function() {
            navigator.sendBeacon("/api/quit");
        });