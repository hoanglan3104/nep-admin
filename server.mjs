import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3333;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ============================================================================
// ĐỌC CẤU HÌNH TẬP TRUNG TỪ LOCAL.PROPERTIES
// ============================================================================
function readLocalProperties() {
  const localPropsPath = path.join(__dirname, '..', 'local.properties');
  const props = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    GEMINI_API_KEY: '',
    ADMIN_EMAIL: 'dqlgamer@gmail.com',
    ADMIN_PASSWORD: '123456'
  };

  try {
    if (fs.existsSync(localPropsPath)) {
      const content = fs.readFileSync(localPropsPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const key = trimmed.substring(0, idx).trim();
            const val = trimmed.substring(idx + 1).trim();
            props[key] = val;
          }
        }
      });
      console.log(`[Config] Đã tự động đọc cấu hình từ ${localPropsPath}`);
      console.log(`[Config] Supabase URL: ${props.SUPABASE_URL || '(Chưa điền)'}`);
      console.log(`[Config] Supabase Anon Key: ${props.SUPABASE_ANON_KEY ? 'ĐÃ CÓ (' + props.SUPABASE_ANON_KEY.slice(0, 15) + '...)' : 'CHƯA CÓ'}`);
      console.log(`[Config] Admin Account: ${props.ADMIN_EMAIL}`);
    } else {
      console.warn(`[Config] Không tìm thấy file ${localPropsPath}`);
    }
  } catch (err) {
    console.error(`[Config] Lỗi đọc local.properties:`, err.message);
  }

  // Tự động sinh file admin/runtime-config.js để khi mở file index.html trực tiếp vẫn nhận cấu hình
  try {
    const runtimeConfigPath = path.join(__dirname, 'runtime-config.js');
    const projectRef = (props.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('.')[0] || '';
    const runtimeContent = `// Tự động sinh từ local.properties - Không cần sửa file này
window.RUNTIME_CONFIG = ${JSON.stringify({
      supabaseUrl: props.SUPABASE_URL,
      supabaseAnonKey: props.SUPABASE_ANON_KEY,
      supabaseServiceRoleKey: props.SUPABASE_SERVICE_ROLE_KEY,
      projectRef: projectRef,
      geminiApiKey: props.GEMINI_API_KEY,
      adminEmail: props.ADMIN_EMAIL,
      adminPassword: props.ADMIN_PASSWORD
    }, null, 2)};
`;
    fs.writeFileSync(runtimeConfigPath, runtimeContent, 'utf8');
    console.log(`[Config] Đã cập nhật admin/runtime-config.js`);
  } catch (e) {
    console.warn(`[Config] Không thể ghi admin/runtime-config.js:`, e.message);
  }

  return props;
}

const config = readLocalProperties();

// ============================================================================
// HTTP SERVER & API ENDPOINTS
// ============================================================================
const server = http.createServer(async (req, res) => {
  let [reqUrl, query] = req.url.split('?');
  if (reqUrl === '/' || reqUrl === '') {
    reqUrl = '/index.html';
  }

  // API 1: Trả về cấu hình tự động đọc từ local.properties
  if (reqUrl === '/api/config') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    });
    const projectRef = (config.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('.')[0] || '';
    res.end(JSON.stringify({
      supabaseUrl: config.SUPABASE_URL,
      supabaseAnonKey: config.SUPABASE_ANON_KEY,
      supabaseServiceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
      geminiApiKey: config.GEMINI_API_KEY,
      adminEmail: config.ADMIN_EMAIL,
      adminPassword: config.ADMIN_PASSWORD,
      projectRef: projectRef,
      source: 'local.properties'
    }));
    return;
  }

  // API 2: Lấy cấu hình Cloud (Gist + local.properties)
  if (reqUrl === '/api/cloud-config' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    });
    const gistPath = path.join(__dirname, '..', 'gist-template.json');
    let cloudData = {};
    if (fs.existsSync(gistPath)) {
      try {
        cloudData = JSON.parse(fs.readFileSync(gistPath, 'utf8'));
      } catch (_) {}
    }
    res.end(JSON.stringify({
      status: cloudData.status || 'online',
      maintenance: cloudData.maintenance || false,
      notice: cloudData.notice || 'Hệ thống hoạt động bình thường',
      title: cloudData.title || 'Thông báo hệ thống',
      supabase_url: config.SUPABASE_URL || cloudData.supabase_url || '',
      supabase_anon_key: config.SUPABASE_ANON_KEY || cloudData.supabase_anon_key || '',
      supabase_service_role_key: config.SUPABASE_SERVICE_ROLE_KEY || cloudData.supabase_service_role_key || '',
      ai_api_key: config.GEMINI_API_KEY || cloudData.ai_api_key || '',
      gemini_api_key: config.GEMINI_API_KEY || cloudData.gemini_api_key || '',
      admin_email: config.ADMIN_EMAIL || cloudData.admin_email || 'admin@qlct.local',
      admin_password: config.ADMIN_PASSWORD || cloudData.admin_password || ''
    }));
    return;
  }

  // API 3: Cập nhật cấu hình lên Cloud Gist & local.properties
  if (reqUrl === '/api/cloud-config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (data.supabase_url) config.SUPABASE_URL = data.supabase_url.trim();
        if (data.supabase_anon_key) config.SUPABASE_ANON_KEY = data.supabase_anon_key.trim();
        if (data.supabase_service_role_key !== undefined) config.SUPABASE_SERVICE_ROLE_KEY = data.supabase_service_role_key.trim();
        if (data.gemini_api_key || data.ai_api_key) config.GEMINI_API_KEY = (data.gemini_api_key || data.ai_api_key).trim();
        if (data.admin_email) config.ADMIN_EMAIL = data.admin_email.trim();
        if (data.admin_password) config.ADMIN_PASSWORD = data.admin_password.trim();

        // 1. Cập nhật local.properties
        const localPropsPath = path.join(__dirname, '..', 'local.properties');
        if (fs.existsSync(localPropsPath)) {
          let pText = fs.readFileSync(localPropsPath, 'utf8');
          const setProp = (k, v) => {
            if (v === undefined) return;
            const re = new RegExp(`^${k}=.*$`, 'm');
            if (re.test(pText)) {
              pText = pText.replace(re, `${k}=${v}`);
            } else {
              pText += `\n${k}=${v}`;
            }
          };
          setProp('SUPABASE_URL', config.SUPABASE_URL);
          setProp('SUPABASE_ANON_KEY', config.SUPABASE_ANON_KEY);
          setProp('SUPABASE_SERVICE_ROLE_KEY', config.SUPABASE_SERVICE_ROLE_KEY);
          setProp('GEMINI_API_KEY', config.GEMINI_API_KEY);
          setProp('ADMIN_EMAIL', config.ADMIN_EMAIL);
          setProp('ADMIN_PASSWORD', config.ADMIN_PASSWORD);
          fs.writeFileSync(localPropsPath, pText, 'utf8');
          console.log(`[Config] Đã cập nhật local.properties`);
        }

        // 2. Cập nhật gist-template.json
        const gistPath = path.join(__dirname, '..', 'gist-template.json');
        const cloudPayload = {
          status: data.maintenance ? 'maintenance' : (data.status || 'online'),
          maintenance: Boolean(data.maintenance),
          notice: data.notice || 'Hệ thống hoạt động bình thường',
          title: data.title || 'Thông báo hệ thống',
          supabase_url: config.SUPABASE_URL,
          supabase_anon_key: config.SUPABASE_ANON_KEY,
          supabase_service_role_key: config.SUPABASE_SERVICE_ROLE_KEY,
          ai_api_key: config.GEMINI_API_KEY,
          gemini_api_key: config.GEMINI_API_KEY,
          admin_email: config.ADMIN_EMAIL,
          admin_password: config.ADMIN_PASSWORD,
          updated_at: new Date().toISOString()
        };
        fs.writeFileSync(gistPath, JSON.stringify(cloudPayload, null, 2), 'utf8');
        console.log(`[Config] Đã cập nhật gist-template.json`);

        // 3. Cập nhật runtime-config.js
        const runtimeConfigPath = path.join(__dirname, 'runtime-config.js');
        const projectRef = (config.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('.')[0] || '';
        const runtimeContent = `// Tự động sinh từ local.properties - Không cần sửa file này
window.RUNTIME_CONFIG = ${JSON.stringify({
          supabaseUrl: config.SUPABASE_URL,
          supabaseAnonKey: config.SUPABASE_ANON_KEY,
          supabaseServiceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
          projectRef: projectRef,
          geminiApiKey: config.GEMINI_API_KEY,
          adminEmail: config.ADMIN_EMAIL,
          adminPassword: config.ADMIN_PASSWORD
        }, null, 2)};
`;
        fs.writeFileSync(runtimeConfigPath, runtimeContent, 'utf8');

        // 4. Nếu có GitHub Token, tự động đồng bộ lên Gist
        let gistUpdated = false;
        const gistId = data.gistId || '8a8b8b98816d189624d875bb77e90d15';
        const ghToken = data.githubToken || process.env.GITHUB_TOKEN;
        if (ghToken) {
          try {
            const patchRes = await fetch(`https://api.github.com/gists/${gistId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${ghToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'User-Agent': 'Nep-Admin'
              },
              body: JSON.stringify({
                description: 'Nếp App - Cloud Configuration Feed',
                files: {
                  'gistfile1.txt': { content: JSON.stringify(cloudPayload, null, 2) }
                }
              })
            });
            gistUpdated = patchRes.ok;
            if (gistUpdated) {
              console.log(`[Gist] Đã đồng bộ trực tiếp lên GitHub Gist ${gistId}`);
            }
          } catch (e) {
            console.warn('[Gist] Lỗi đẩy lên GitHub:', e.message);
          }
        }

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=UTF-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true, gistUpdated, config: cloudPayload }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API 4: Cập nhật tài khoản và quyền Admin trực tiếp vào local.properties
  if (reqUrl === '/api/admin/credentials' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.adminEmail) config.ADMIN_EMAIL = data.adminEmail.trim();
        if (data.adminPassword) config.ADMIN_PASSWORD = data.adminPassword.trim();

        const localPropsPath = path.join(__dirname, '..', 'local.properties');
        if (fs.existsSync(localPropsPath)) {
          let propsText = fs.readFileSync(localPropsPath, 'utf8');
          if (data.adminEmail) {
            if (/^ADMIN_EMAIL=/m.test(propsText)) {
              propsText = propsText.replace(/^ADMIN_EMAIL=.*$/m, `ADMIN_EMAIL=${config.ADMIN_EMAIL}`);
            } else {
              propsText += `\nADMIN_EMAIL=${config.ADMIN_EMAIL}`;
            }
          }
          if (data.adminPassword) {
            if (/^ADMIN_PASSWORD=/m.test(propsText)) {
              propsText = propsText.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${config.ADMIN_PASSWORD}`);
            } else {
              propsText += `\nADMIN_PASSWORD=${config.ADMIN_PASSWORD}`;
            }
          }
          fs.writeFileSync(localPropsPath, propsText, 'utf8');
          console.log(`[Admin] Đã cập nhật quyền Admin: ${config.ADMIN_EMAIL}`);
        }

        const runtimeConfigPath = path.join(__dirname, 'runtime-config.js');
        const projectRef = (config.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('.')[0] || '';
        const runtimeContent = `// Tự động sinh từ local.properties - Không cần sửa file này
window.RUNTIME_CONFIG = ${JSON.stringify({
          supabaseUrl: config.SUPABASE_URL,
          supabaseAnonKey: config.SUPABASE_ANON_KEY,
          supabaseServiceRoleKey: config.SUPABASE_SERVICE_ROLE_KEY,
          projectRef: projectRef,
          geminiApiKey: config.GEMINI_API_KEY,
          adminEmail: config.ADMIN_EMAIL,
          adminPassword: config.ADMIN_PASSWORD
        }, null, 2)};
`;
        fs.writeFileSync(runtimeConfigPath, runtimeContent, 'utf8');

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=UTF-8',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ success: true, adminEmail: config.ADMIN_EMAIL }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API 5: Proxy gọi Supabase trực tiếp từ server
  if (reqUrl.startsWith('/api/supabase/')) {
    const supabasePath = reqUrl.replace('/api/supabase', '');
    const targetUrl = config.SUPABASE_URL.replace(/\/$/, '') + supabasePath + (query ? '?' + query : '');

    try {
      const response = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'apikey': config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const bodyText = await response.text();
      res.writeHead(response.status, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(bodyText);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Phục vụ file tĩnh
  const filePath = path.join(__dirname, reqUrl);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Nếp Web Admin Portal đang hoạt động tại:`);
    console.log(`👉 http://localhost:${port}`);
    console.log(`👉 Form Cấu hình Cloud: http://localhost:${port}/cloud-config.html`);
    console.log(`📡 Kết nối Supabase: ${config.SUPABASE_URL}`);
    console.log(`🔑 Key từ local.properties: ĐÃ TẢI THÀNH CÔNG`);
    console.log(`======================================================\n`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n⚠️  Cổng ${PORT} hiện đang được sử dụng (Server Nếp Admin đã chạy sẵn trước đó!).`);
    console.log(`👉 Bạn có thể truy cập ngay tại: http://localhost:${PORT}`);
    console.log(`👉 Form Cấu hình Cloud: http://localhost:${PORT}/cloud-config.html`);
    console.log(`Hoặc đang thử mở trên cổng dự phòng ${Number(PORT) + 1}...\n`);
    startServer(Number(PORT) + 1);
  } else {
    console.error('Lỗi khởi động server:', err);
  }
});

startServer(PORT);
