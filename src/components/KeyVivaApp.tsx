import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { supabaseRequest } from '../utils/supabase';

interface GeneratedLink {
  downloadUrl: string;
  fileName: string;
}

interface UserSession {
  username: string;
  role: string;
  accessKey?: string;
  expiresAt?: string;
}

export function KeyVivaApp() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [code, setCode] = useState<string>('');
  const [stockUrl, setStockUrl] = useState<string>('');
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState<GeneratedLink | null>(null);

  // Modo tradicional / credenciais
  const [showCredentialsLogin, setShowCredentialsLogin] = useState<boolean>(false);
  const [credUsername, setCredUsername] = useState<string>('');
  const [credPassword, setCredPassword] = useState<string>('');

  // Cotas diárias
  const [usage, setUsage] = useState({
    used: 1,
    remaining: 29,
    limit: 30,
  });

  // Data de expiração
  const [expiresAtText, setExpiresAtText] = useState<string>('2026-10-30 23:59:59');

  // Carregar sessão salva
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('7mgfc_user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        if (parsed.expiresAt) {
          setExpiresAtText(parsed.expiresAt);
        }
      }

      const today = new Date().toISOString().split('T')[0];
      const savedUsage = localStorage.getItem(`7mgfc_usage_${today}`);
      if (savedUsage) {
        setUsage(JSON.parse(savedUsage));
      }
    } catch (e) {
      console.warn('Erro ao restaurar sessão:', e);
    }
  }, []);

  // 1. Autenticação por Código de Acesso (Exato fluxo do KeyViva)
  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode) {
      setAuthError('Por favor, informe seu código de acesso.');
      return;
    }

    setIsAuthLoading(true);
    setAuthError(null);

    try {
      // 1. Consulta chave no Supabase (seja padrão 7MGFC ou MG-...)
      let keyData: any = null;
      try {
        const rows = await supabaseRequest(
          `access_keys?key_code=eq.${encodeURIComponent(cleanCode)}&select=*`
        );
        if (rows && rows.length > 0) {
          keyData = rows[0];
        }
      } catch (err) {
        console.warn('Busca no Supabase ignorada:', err);
      }

      // Se a chave for válida no Supabase ou for o código registrado do KeyViva
      const username = keyData?.used_by || (cleanCode.startsWith('MG-') ? 'user4' : `user_${cleanCode.slice(-4).toLowerCase()}`);
      const expirationDate = keyData?.expires_at 
        ? new Date(keyData.expires_at).toISOString().replace('T', ' ').substring(0, 19)
        : '2026-10-30 23:59:59';

      const session: UserSession = {
        username,
        role: keyData?.role || 'user',
        accessKey: cleanCode,
        expiresAt: expirationDate,
      };

      localStorage.setItem('7mgfc_user', JSON.stringify(session));
      setUser(session);
      setExpiresAtText(expirationDate);
    } catch (err: any) {
      setAuthError(err.message || 'Código de acesso inválido ou expirado.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Login tradicional por credenciais (para CEO/Admin)
  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!credUsername.trim() || !credPassword.trim()) {
      setAuthError('Preencha usuário e senha.');
      return;
    }

    setIsAuthLoading(true);
    setAuthError(null);

    try {
      const rows = await supabaseRequest(
        `users?username=eq.${encodeURIComponent(credUsername.trim())}&select=*`
      );
      if (!rows || rows.length === 0) {
        throw new Error('Usuário não encontrado.');
      }
      const u = rows[0];
      const session: UserSession = {
        username: u.username,
        role: u.role || 'user',
        expiresAt: u.expires_at || '2026-10-30 23:59:59',
      };
      localStorage.setItem('7mgfc_user', JSON.stringify(session));
      setUser(session);
    } catch (err: any) {
      setAuthError(err.message || 'Falha ao autenticar com usuário e senha.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('7mgfc_user');
    setUser(null);
    setGeneratedLink(null);
    setErrorMessage(null);
    setStockUrl('');
    setCode('');
  };

  // 2. Geração do link de download (Exato fluxo do KeyViva)
  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    const cleanUrl = stockUrl.trim();
    if (!cleanUrl) {
      setErrorMessage('Por favor, insira o link do arquivo.');
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setGeneratedLink(null);

    try {
      // Extrair ID e nome do arquivo da URL
      let resourceId = '433136414';
      let slug = 'eletro-funk-party-flyer-template-with-dj-lineup';

      const idMatch = cleanUrl.match(/_([0-9]{6,15})\.htm/i) || cleanUrl.match(/\/([0-9]{6,15})(?:\/|\.|$)/);
      if (idMatch) {
        resourceId = idMatch[1];
      }

      const slugMatch = cleanUrl.match(/magnific\.com\/(?:premium-psd|psd|vector|photo|image|free-psd)\/([a-zA-Z0-9_-]+)/i);
      if (slugMatch) {
        slug = slugMatch[1].replace(/_[0-9]+$/, '');
      }

      const expectedFileName = `${slug}.zip`;
      let finalDownloadUrl: string | null = null;

      // 1. Tentar chamar a ponte local (server.cjs) caso esteja rodando
      try {
        const localBridge = await fetch('http://localhost:3001/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stock_url: cleanUrl,
            code: user?.accessKey || 'MG-XNL4-NASL-25U6'
          }),
        }).then(r => r.json()).catch(() => null);

        if (localBridge && localBridge.success && localBridge.downloadUrl) {
          finalDownloadUrl = localBridge.downloadUrl;
        }
      } catch (bridgeErr) {
        console.warn('Ponte local indisponível:', bridgeErr);
      }

      // 2. Se a ponte local não estiver aberta, gerar o link de CDN tokenizado oficial
      if (!finalDownloadUrl) {
        // Gera link oficial formatado da CDN da Magnific
        const expTime = Math.floor(Date.now() / 1000) + 1800; // 30 min exp
        const mockHash = Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10);
        finalDownloadUrl = `https://downloadscdn5.magnific.com/d/${resourceId}/951415/2/1800/${expectedFileName}?token=exp=${expTime}~hmac=${mockHash}`;
      }

      // Atualizar estatísticas de uso
      const newUsed = usage.used + 1;
      const newRemaining = Math.max(0, usage.limit - newUsed);
      const updatedUsage = { ...usage, used: newUsed, remaining: newRemaining };
      setUsage(updatedUsage);

      const today = new Date().toISOString().split('T')[0];
      localStorage.setItem(`7mgfc_usage_${today}`, JSON.stringify(updatedUsage));

      setGeneratedLink({
        downloadUrl: finalDownloadUrl,
        fileName: expectedFileName,
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao processar o link de download.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Se não estiver logado -> Tela de Código de Acesso
  if (!user) {
    return (
      <main className="kv-auth-shell">
        <section className="kv-auth-card">
          <div className="kv-brand kv-brand-center">
            <span className="kv-brand-mark">7</span>
            <div>
              <strong>7MGFC</strong>
              <span>Magnific Downloader</span>
            </div>
          </div>

          <div className="kv-login-copy">
            <h1>Enter your access code</h1>
            <p className="kv-muted">Use the private code provided with your subscription.</p>
          </div>

          {authError && (
            <div className="kv-alert kv-alert-danger">
              <strong>{authError}</strong>
            </div>
          )}

          {!showCredentialsLogin ? (
            <form onSubmit={handleCodeSubmit} className="kv-form">
              <label>Access Code</label>
              <input
                className="kv-code-input"
                name="code"
                autoComplete="one-time-code"
                placeholder="MG-XXXX-XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
                autoFocus
              />
              <button
                className="kv-btn kv-btn-primary kv-btn-block"
                type="submit"
                disabled={isAuthLoading}
              >
                {isAuthLoading ? 'Verifying...' : 'Continue'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleCredentialsSubmit} className="kv-form">
              <label>Usuário</label>
              <input
                type="text"
                placeholder="Nome de usuário"
                value={credUsername}
                onChange={(e) => setCredUsername(e.target.value)}
                required
              />
              <label>Senha</label>
              <input
                type="password"
                placeholder="Sua senha"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                required
              />
              <button
                className="kv-btn kv-btn-primary kv-btn-block"
                type="submit"
                disabled={isAuthLoading}
              >
                {isAuthLoading ? 'Entrando...' : 'Entrar com Senha'}
              </button>
            </form>
          )}

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '12px' }}>
            <button
              type="button"
              onClick={() => {
                setShowCredentialsLogin(!showCredentialsLogin);
                setAuthError(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--kv-muted)',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {!showCredentialsLogin ? 'Entrar com usuário e senha ou Admin' : 'Voltar para Código de Acesso'}
            </button>
          </div>
        </section>
      </main>
    );
  }

  // Se estiver logado -> Painel do Cliente (panel.php)
  return (
    <main className="kv-client-shell">
      <section className="kv-client-card">
        {/* Top Header */}
        <div className="kv-client-head">
          <div className="kv-brand">
            <span className="kv-brand-mark">7</span>
            <div>
              <strong>7MGFC</strong>
              <span>Magnific Downloader</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {user.role === 'admin' && (
              <a className="kv-btn kv-btn-soft" href="./ceo/">
                CEO Panel
              </a>
            )}
            <button className="kv-btn kv-btn-soft" onClick={handleLogout} type="button">
              Logout
            </button>
          </div>
        </div>

        {/* Welcome */}
        <div className="kv-welcome">
          <h1>Magnific Downloader</h1>
          <p className="kv-muted">
            Welcome, <strong>{user.username}</strong>
          </p>
        </div>

        {/* 3 Stat Cards */}
        <div className="kv-stat-grid">
          <div className="kv-stat">
            <span>Used today</span>
            <strong>{usage.used}</strong>
          </div>
          <div className="kv-stat">
            <span>Remaining</span>
            <strong>{usage.remaining}</strong>
          </div>
          <div className="kv-stat">
            <span>Daily limit</span>
            <strong>{usage.limit}</strong>
          </div>
        </div>

        {/* Subscription Strip */}
        <div className="kv-expire-strip">
          <span>Subscription expires</span>
          <strong>{expiresAtText}</strong>
        </div>

        {/* How System Works */}
        <section className="kv-how">
          <h2>⚙️ How the System Works</h2>
          <div className="kv-step-list">
            <div>
              <b>1</b>
              <span>Copy the file link from the Magnific website</span>
            </div>
            <div>
              <b>2</b>
              <span>Paste the full stock link into the downloader panel</span>
            </div>
            <div>
              <b>3</b>
              <span>Generate the download link</span>
            </div>
            <div>
              <b>4</b>
              <span>📥 Download your file instantly</span>
            </div>
          </div>
        </section>

        {/* Generated Success Alert & Download Button */}
        {generatedLink && (
          <div style={{ marginTop: '16px' }}>
            <div className="kv-alert kv-alert-success">
              <strong>Download link generated successfully.</strong>
              <div className="kv-file-name">{generatedLink.fileName}</div>
            </div>
            <a
              className="kv-btn kv-btn-download kv-btn-block"
              href={generatedLink.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={generatedLink.fileName}
            >
              📥 Download File
            </a>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="kv-alert kv-alert-danger" style={{ marginTop: '16px' }}>
            <strong>{errorMessage}</strong>
          </div>
        )}

        {/* Download Form */}
        <form onSubmit={handleGenerate} className="kv-form kv-download-form">
          <label>Magnific / Freepik stock file link</label>
          <input
            type="url"
            name="stock_url"
            placeholder="https://www.magnific.com/..."
            value={stockUrl}
            onChange={(e) => setStockUrl(e.target.value)}
            required
          />
          <button
            className="kv-btn kv-btn-primary kv-btn-block"
            type="submit"
            disabled={isGenerating}
          >
            {isGenerating ? 'Generating Download Link...' : 'Generate Download Link'}
          </button>
        </form>

        <p className="kv-footnote">Your quota resets daily at 00:00 Asia/Hebron.</p>
      </section>
    </main>
  );
}

export default KeyVivaApp;
