/*
 * 管理后台前端脚本
 *
 * ★ 原则：**不引入任何框架**。
 *   后台只有三类交互：提交表单、确认删除、导入向导。
 *   原生 fetch + 事件委托足够，且不需要构建步骤 —— 改完刷新就能看到效果。
 *
 * ★ 所有文本都走 textContent 而不是 innerHTML —— 数据里可能有用户提交的
 *   内容（如纠错说明），用 innerHTML 就等于自己开了个 XSS 口子。
 */

(function () {
  'use strict';

  /* ============================================================
   * 通用
   * ============================================================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /** POST 表单（application/x-www-form-urlencoded），返回 JSON */
  function postForm(url, obj) {
    var body = Object.keys(obj)
      .map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k] === undefined ? '' : obj[k]);
      })
      .join('&');
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body,
      credentials: 'same-origin'
    }).then(readJson);
  }

  /** POST JSON */
  function postJson(url, obj) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(obj || {}),
      credentials: 'same-origin'
    }).then(readJson);
  }

  /** GET JSON */
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(readJson);
  }

  function readJson(res) {
    return res.json().catch(function () {
      return { ok: false, message: '服务器返回了无法解析的内容（HTTP ' + res.status + '）' };
    });
  }

  /** 顶部错误条 */
  function showError(msg, target) {
    var box = target || $('#form-error') || $('#import-msg');
    if (!box) { alert(msg); return; }
    box.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'alert alert--error';
    div.textContent = msg;
    box.appendChild(div);
  }

  function clearError(target) {
    var box = target || $('#form-error') || $('#import-msg');
    if (box) box.innerHTML = '';
  }

  /** 把表单序列化成对象（同名字段后者覆盖前者） */
  function serialize(form) {
    var out = {};
    $$('input, select, textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') {
        out[el.name] = el.checked ? 'on' : '';
      } else if (el.type === 'file') {
        // 跳过
      } else {
        out[el.name] = el.value;
      }
    });
    return out;
  }

  /* ============================================================
   * 公司 / 线路 / 关联 表单提交
   * ============================================================ */

  function bindEntityForm(formId, apiPath, backPath) {
    var form = $(formId);
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearError();
      var data = serialize(form);

      // 编辑时把 id 放进表单数据（用 _id 这个键，服务端按它判断新建/更新）
      if (form.dataset.id) data._id = form.dataset.id;

      postForm(apiPath, data).then(function (r) {
        if (!r.ok) { showError(r.message || '保存失败'); return; }
        window.location.href = backPath;
      }).catch(function () {
        showError('请求失败，请检查后台服务是否仍在运行');
      });
    });

    // 删除按钮
    var del = $('#btn-delete');
    if (del) {
      del.addEventListener('click', function () {
        if (!confirm('确定删除？关联数据会一并清理，此操作不可撤销。')) return;
        var url = apiPath.replace('/save', '/delete');
        postForm(url, { _id: form.dataset.id }).then(function (r) {
          if (!r.ok) { showError(r.message || '删除失败'); return; }
          window.location.href = backPath;
        });
      });
    }
  }

  /* ============================================================
   * 列表页的删除（事件委托）
   * ============================================================ */

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.dataset) return;

    /* 删公司 */
    if (t.dataset.delCompany) {
      var name = t.dataset.delName || '';
      if (!confirm('删除公司「' + name + '」？\n\n该公司的全部线路关联会一并删除，此操作不可撤销。')) return;
      postForm('/api/company/delete', { _id: t.dataset.delCompany }).then(function (r) {
        if (!r.ok) { alert(r.message || '删除失败'); return; }
        var extra = r.cascadedLinks ? '（同时清理了 ' + r.cascadedLinks + ' 条线路关联）' : '';
        alert('已删除' + extra);
        location.reload();
      });
      return;
    }

    /* 删线路 */
    if (t.dataset.delRoute) {
      var rk = t.dataset.delName || '';
      if (!confirm('删除线路「' + rk + '」？\n\n挂在这条线路上的全部公司关联会一并删除，此操作不可撤销。')) return;
      postForm('/api/route/delete', { _id: t.dataset.delRoute }).then(function (r) {
        if (!r.ok) { alert(r.message || '删除失败'); return; }
        var extra2 = r.cascadedLinks ? '（同时清理了 ' + r.cascadedLinks + ' 条关联）' : '';
        alert('已删除' + extra2);
        location.reload();
      });
      return;
    }

    /* 删关联 */
    if (t.dataset.delLink) {
      if (!confirm('删除这条「公司 × 线路」关联？')) return;
      postForm('/api/link/delete', { _id: t.dataset.delLink }).then(function (r) {
        if (!r.ok) { alert(r.message || '删除失败'); return; }
        location.reload();
      });
      return;
    }

    /* 重算某条线路的计数（质量看板里的一键修复） */
    if (t.dataset.fixCount) {
      postForm('/api/route/delete', {}).then(function () { /* 占位，见下 */ });
      return;
    }
  });

  /* ============================================================
   * 纠错审核
   * ============================================================ */

  $$('form[data-review]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // 点的是哪个按钮，就用哪个状态
      var status = (e.submitter && e.submitter.dataset && e.submitter.dataset.status) || 'accepted';
      var noteEl = $('input[name="note"]', form);
      var id = form.dataset.review;

      postForm('/api/correction/review', { _id: id, status: status, note: noteEl ? noteEl.value : '' })
        .then(function (r) {
          if (!r.ok) { alert(r.message || '操作失败'); return; }
          location.reload();
        });
    });
  });

  /* ============================================================
   * 批量导入向导
   * ============================================================ */

  var importState = null;   // { headers, rows, mapping, valid }

  function initImport() {
    var fileEl = $('#file');
    if (!fileEl) return;   // 不是导入页

    var btnPreview = $('#btn-preview');
    var btnApply = $('#btn-apply');
    var btnRevalidate = $('#btn-revalidate');

    btnPreview.addEventListener('click', function () {
      clearError();
      if (!fileEl.files || !fileEl.files.length) {
        showError('请先选择一个 .xlsx 或 .csv 文件');
        return;
      }
      var fd = new FormData();
      fd.append('file', fileEl.files[0]);
      btnPreview.disabled = true;
      btnPreview.textContent = '解析中…';

      fetch('/api/import/preview', { method: 'POST', body: fd, credentials: 'same-origin' })
        .then(readJson)
        .then(function (r) {
          btnPreview.disabled = false;
          btnPreview.textContent = '解析并预览';
          if (!r.ok) { showError(r.message || '解析失败'); return; }

          importState = {
            headers: r.headers,
            mapping: r.mapping,
            valid: r.valid,
            rows: null
          };
          renderMapping(r);
          renderResult(r);
          $('#import-step2').classList.remove('hidden');
          $('#import-step2').scrollIntoView({ behavior: 'smooth' });
        })
        .catch(function () {
          btnPreview.disabled = false;
          btnPreview.textContent = '解析并预览';
          showError('上传失败，请检查后台服务是否仍在运行');
        });
    });

    /** 渲染映射界面（每个文件表头一行，右侧下拉选字段） */
    function renderMapping(r) {
      var box = $('#mapping');
      box.innerHTML = '';
      r.headers.forEach(function (h, i) {
        var row = document.createElement('div');
        row.className = 'maprow';

        var src = document.createElement('div');
        src.className = 'maprow__src';
        src.textContent = h || ('（第 ' + (i + 1) + ' 列）');

        var arrow = document.createElement('div');
        arrow.className = 'maprow__arrow';
        arrow.textContent = '→';

        var sel = document.createElement('select');
        sel.className = 'input';
        sel.dataset.col = String(i);
        var optNone = document.createElement('option');
        optNone.value = '';
        optNone.textContent = '（忽略这一列）';
        sel.appendChild(optNone);
        r.fields.forEach(function (f) {
          var o = document.createElement('option');
          o.value = f.key;
          o.textContent = f.label + (f.required ? ' *' : '');
          if (r.mapping[i] === f.key) o.selected = true;
          sel.appendChild(o);
        });

        row.appendChild(src);
        row.appendChild(arrow);
        row.appendChild(sel);
        box.appendChild(row);
      });
    }

    /** 渲染校验结果 */
    function renderResult(r) {
      var s = r.summary;
      var sum = $('#summary');
      sum.innerHTML = '';

      var cls = s.invalidCount ? 'alert--warn' : 'alert--ok';
      var div = document.createElement('div');
      div.className = 'alert ' + cls;
      div.textContent = '共 ' + s.total + ' 行：可导入 ' + s.validCount + ' 行，' +
        '有问题 ' + s.invalidCount + ' 行；' +
        '涉及公司 ' + (s.newCompanies + s.existingCompanies) + ' 家（新建 ' + s.newCompanies +
        '，已有 ' + s.existingCompanies + '）；将新建线路 ' + s.newRoutes + ' 条。';
      sum.appendChild(div);

      /* 错误行 —— 必须逐行给出原因（PRD B3） */
      var ibox = $('#invalid-box');
      ibox.innerHTML = '';
      if (r.invalid && r.invalid.length) {
        var f = document.createElement('div');
        f.className = 'fieldset';
        var t = document.createElement('div');
        t.className = 'fieldset__title';
        t.textContent = '错误行预览（共 ' + s.invalidCount + ' 行，这些行会被跳过，不会入库）';
        f.appendChild(t);

        r.invalid.forEach(function (x) {
          var row = document.createElement('div');
          row.className = 'invalid-row';

          var no = document.createElement('div');
          no.className = 'invalid-row__no';
          no.textContent = '第 ' + x.lineNo + ' 行';

          var err = document.createElement('div');
          err.className = 'invalid-row__err';
          err.textContent = (x.errors || []).join('；');

          var data = document.createElement('div');
          data.className = 'invalid-row__data';
          data.textContent = describeRow(x.row);

          row.appendChild(no);
          row.appendChild(err);
          row.appendChild(data);
          f.appendChild(row);
        });
        ibox.appendChild(f);
      }

      /* 可导入行预览（前若干条，让用户确认映射对不对） */
      var vbox = $('#valid-box');
      vbox.innerHTML = '';
      if (r.preview && r.preview.length) {
        var vf = document.createElement('div');
        vf.className = 'fieldset';
        var vt = document.createElement('div');
        vt.className = 'fieldset__title';
        vt.textContent = '可导入行预览（前 ' + r.preview.length + ' 行）';
        vf.appendChild(vt);
        var tb = document.createElement('table');
        tb.className = 'tb tb--sm';
        var thead = document.createElement('thead');
        var htr = document.createElement('tr');
        ['行号', '公司', '线路', '时效', '直达', '频率', '价格备注'].forEach(function (h) {
          var th = document.createElement('th');
          th.textContent = h;
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        tb.appendChild(thead);

        var tbody = document.createElement('tbody');
        r.preview.forEach(function (p) {
          var tr = document.createElement('tr');
          var cells = [
            String(p.lineNo),
            p.row.name || '',
            (p.row.fromCity || '') + '-' + (p.row.toCity || ''),
            p.row.transitDays === null || p.row.transitDays === undefined ? '—' : String(p.row.transitDays),
            p.row.isDirect ? '是' : '否',
            p.row.frequency || '',
            p.row.priceNote || ''
          ];
          cells.forEach(function (c) {
            var td = document.createElement('td');
            td.textContent = c;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tb.appendChild(tbody);
        vf.appendChild(tb);
        vbox.appendChild(vf);
      }

      btnApply.disabled = !(s.validCount > 0);
      btnApply.textContent = s.validCount > 0
        ? '确认导入 ' + s.validCount + ' 行' + (s.invalidCount ? '（跳过 ' + s.invalidCount + ' 行错误数据）' : '')
        : '没有可导入的数据';
    }

    function describeRow(row) {
      if (!row) return '';
      var parts = [];
      if (row.name) parts.push(row.name);
      if (row.fromCity || row.toCity) parts.push((row.fromCity || '?') + '→' + (row.toCity || '?'));
      if (row.phone) parts.push(row.phone);
      return parts.join(' · ');
    }

    /* 按当前映射重新校验 */
    if (btnRevalidate) {
      btnRevalidate.addEventListener('click', function () {
        if (!importState) return;
        var mapping = $$('#mapping select').map(function (s) { return s.value; });
        clearError();

        /* 前端只重发映射，让服务端重新校验。
           但服务端没有原始二维行 —— 所以这里改为报错提示：
           为确保正确性，重新映射后请重新解析文件。 */
        // 实际上服务端在 preview 时已把 mapping 用完就丢了，这里最稳妥是重传文件
        if (!fileEl.files || !fileEl.files.length) {
          showError('文件已不在选择框中，请重新选择文件');
          return;
        }
        var fd = new FormData();
        fd.append('file', fileEl.files[0]);
        fd.append('mapping', JSON.stringify(mapping));
        fetch('/api/import/preview', { method: 'POST', body: fd, credentials: 'same-origin' })
          .then(readJson)
          .then(function (r) {
            if (!r.ok) { showError(r.message || '校验失败'); return; }
            importState.valid = r.valid;
            /* 手工映射优先：保留用户刚选的映射，不要被自动映射覆盖 */
            r.mapping = mapping;
            renderMapping(r);
            renderResult(r);
          });
      });
    }

    /* 确认导入 */
    btnApply.addEventListener('click', function () {
      if (!importState || !importState.valid) return;
      if (!confirm('确认导入 ' + importState.valid.length + ' 行？')) return;
      btnApply.disabled = true;
      btnApply.textContent = '导入中…';

      postJson('/api/import/apply', { valid: importState.valid }).then(function (r) {
        if (!r.ok) {
          showError(r.message || '导入失败');
          btnApply.disabled = false;
          btnApply.textContent = '重试导入';
          return;
        }
        var msg = '导入完成：新建公司 ' + r.created + ' 家，' +
          '新增线路公司关联 ' + r.links + ' 条' +
          (r.updated ? '，命中已有公司 ' + r.updated + ' 次' : '') +
          (r.failed && r.failed.length ? '，写入失败 ' + r.failed.length + ' 行' : '') + '。';
        alert(msg);
        window.location.href = '/quality';
      });
    });
  }

  /* ============================================================
   * 启动
   * ============================================================ */

  document.addEventListener('DOMContentLoaded', function () {
    bindEntityForm('#company-form', '/api/company/save', '/companies');
    bindEntityForm('#route-form', '/api/route/save', '/routes');
    bindEntityForm('#link-form', '/api/link/save', '/links');
    initImport();
  });
})();
