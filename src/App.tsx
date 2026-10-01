import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import type {
  AppState,
  ResourceDetails,
  DownloadProgress,
  HistoryRecord,
  AppSettings,
  UserSession,
} from './types';
import {
  isValidUrl,
  extractDomain,
  extractFilename,
  detectFileType,
  isProtectedResource,
  parseMagnificOrFreepik,
  formatBytes,
  formatSpeed,
  formatDate,
} from './utils';
import {
  fetchUserDailyUsage,
  incrementDownloadUsage,
  recordDownloadHistory,
  supabaseRequest,
} from './utils/supabase';
import { executeWebDownload } from './utils/downloader';
import { AuthView } from './components/AuthView';

type ActiveTab = 'downloader' | 'dashboard' | 'history' | 'settings';

const DEFAULT_SETTINGS: AppSettings = {
  conflictAction: 'uniquify',
  autoDownload: false,
  subfolder: '7MGFC',
  notifications: true,
  maxHistoryItems: 50,
  magnificApiKey: '',
  bypassPremium: true,
};

export function App() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('downloader');
  const [url, setUrl] = useState<string>('');
  const [appState, setAppState] = useState<AppState>('idle');
  const [resource, setResource] = useState<ResourceDetails | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [copied, setCopied] = useState<boolean>(false);
  const [usage, setUsage] = useState({ used: 0, limit: 30, remaining: 30 });
  const [accountDetails, setAccountDetails] = useState<any>(null);

  // Carrega configurações e histórico do localStorage
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('7mgfc_settings');
      if (savedSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
      }

      const savedHistory = localStorage.getItem('7mgfc_history');
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (err) {
      console.warn('Erro ao carregar dados locais:', err);
    }
  }, []);

  // Salva configurações no localStorage
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      localStorage.setItem('7mgfc_settings', JSON.stringify(updated));
      return updated;
    });
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.setItem('7mgfc_settings', JSON.stringify(DEFAULT_SETTINGS));
  };

  // Salva histórico no localStorage
  const saveHistory = useCallback(
    (newHistory: HistoryRecord[]) => {
      const max = settings.maxHistoryItems || 50;
      const trimmed = newHistory.slice(0, max);
      setHistory(trimmed);
      localStorage.setItem('7mgfc_history', JSON.stringify(trimmed));
    },
    [settings.maxHistoryItems]
  );

  // Carrega usuário da sessão
  const loadUserSession = useCallback(async () => {
    const saved = localStorage.getItem('7mgfc_user');
    if (!saved) {
      setUser(null);
      return;
    }

    try {
      const parsedUser = JSON.parse(saved) as UserSession;
      setUser(parsedUser);

      // Busca dados atualizados do usuário no Supabase
      const usersData = await supabaseRequest(
        `users?username=eq.${encodeURIComponent(parsedUser.username)}&select=*`
      ).catch(() => null);

      const freshUser = usersData && usersData[0] ? usersData[0] : parsedUser;

      if (freshUser.is_active === false) {
        handleLogout();
        return;
      }

      setAccountDetails(freshUser);

      // Consulta limites diários
      const usageData = await fetchUserDailyUsage(freshUser.username || freshUser.id);
      const limit = freshUser.daily_limit || 30;
      setUsage({
        used: usageData.used,
        limit,
        remaining: Math.max(0, limit - usageData.used),
      });
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    loadUserSession();
  }, [loadUserSession]);

  const handleLogout = () => {
    localStorage.removeItem('7mgfc_user');
    setUser(null);
    setAccountDetails(null);
  };

  // Colar link da área de transferência
  const handlePasteClipboard = async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text && isValidUrl(text)) {
          setUrl(text);
          handleProcessUrl(undefined, text);
        } else if (text) {
          setUrl(text);
        }
      }
    } catch (err) {
      console.warn('Permissão de clipboard não concedida:', err);
    }
  };

  // Iniciar download oficial no navegador
  const triggerDownload = useCallback(
    async (targetResource: ResourceDetails) => {
      if (!targetResource?.url) {
        setErrorMessage('Nenhuma URL de download autorizada foi encontrada.');
        setAppState('error');
        return;
      }

      setAppState('downloading');
      setErrorMessage(null);
      setProgress({
        downloadId: Date.now(),
        receivedBytes: 0,
        totalBytes: targetResource.size || 0,
        percent: 0,
        speed: 0,
        state: 'in_progress',
      });

      try {
        const result = await executeWebDownload({
          url: targetResource.url,
          filename: targetResource.filename,
          apiKey: settings.magnificApiKey,
          alternativeUrls: targetResource.alternativeDownloadUrls,
          onProgress: (p) => setProgress(p),
        });

        if (!result.success) {
          setAppState('error');
          setErrorMessage(result.error || 'Falha ao processar download do arquivo.');
          return;
        }

        // Sucesso no download
        setAppState('completed');

        // Incrementa uso diário no Supabase
        if (user?.username) {
          const updatedUsage = await incrementDownloadUsage(user.username, usage.limit);
          setUsage(updatedUsage);
          await recordDownloadHistory(
            user.username,
            targetResource.originalUrl || targetResource.url,
            targetResource.url,
            targetResource.resourceId
          );
        }

        // Registra histórico local
        const newRecord: HistoryRecord = {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          filename: targetResource.filename,
          url: targetResource.originalUrl || targetResource.url,
          date: Date.now(),
          size: targetResource.size || null,
          status: 'completed',
          type: targetResource.type || 'ARQUIVO',
        };

        saveHistory([newRecord, ...history]);
      } catch (err: any) {
        console.error('[7MGFC Download]', err);
        setAppState('error');
        setErrorMessage(err?.message || 'Erro inesperado durante o download.');
      }
    },
    [settings, user, usage.limit, history, saveHistory]
  );

  // Processamento da URL
  const handleProcessUrl = async (e?: FormEvent, directUrl?: string) => {
    if (e) e.preventDefault();

    const targetUrl = typeof directUrl === 'string' ? directUrl : url;
    const trimmed = targetUrl.trim();

    if (!trimmed) {
      setErrorMessage('Cole uma URL para processar.');
      setAppState('error');
      return;
    }

    if (!isValidUrl(trimmed)) {
      setErrorMessage('URL inválida. Verifique o link e tente novamente.');
      setAppState('error');
      return;
    }

    setErrorMessage(null);
    setAppState('processing');
    setResource(null);
    setProgress(null);

    await new Promise((resolve) => setTimeout(resolve, 300));

    // 1. Magnific / Freepik Parser
    const magnificRes = parseMagnificOrFreepik(trimmed);

    if (magnificRes) {
      const isPremium = magnificRes.tier === 'premium';
      let isProtected = magnificRes.isProtected;
      let statusMessage = magnificRes.statusMessage;

      if (settings.bypassPremium) {
        isProtected = false;
        statusMessage = 'Bypass Ativado ⚡ Download Oficial Liberado';
      }

      const identifiedResource: ResourceDetails = {
        url: magnificRes.downloadUrl,
        originalUrl: trimmed,
        domain: magnificRes.platform === 'magnific' ? 'magnific.com' : 'freepik.com',
        filename: magnificRes.cleanFilename,
        size: null,
        type: magnificRes.fileType,
        status: isProtected ? 'protected' : 'available',
        statusMessage,
        isProtected,
        platform: magnificRes.platform,
        resourceId: magnificRes.resourceId,
        category: magnificRes.category,
        slug: magnificRes.slug,
        isPremium,
        isDirectCdnUrl: magnificRes.isDirectCdnUrl,
        alternativeDownloadUrls: magnificRes.alternativeDownloadUrls,
        cdnDetails: magnificRes.cdnDetails,
        pageUrl: magnificRes.pageUrl,
        tokenInfo: magnificRes.cdnDetails
          ? {
              token: magnificRes.cdnDetails.token,
              expiresAt: magnificRes.cdnDetails.tokenExpiresAt,
              isExpired: magnificRes.cdnDetails.isExpired,
              hmac: magnificRes.cdnDetails.hmac,
            }
          : undefined,
      };

      setResource(identifiedResource);
      setAppState('identified');

      if (settings.autoDownload && !isProtected) {
        triggerDownload(identifiedResource);
      }
      return;
    }

    // 2. Links Genéricos
    const protection = isProtectedResource(trimmed);
    const domain = extractDomain(trimmed);
    const filename = extractFilename(trimmed);
    const type = detectFileType(filename);

    if (protection.isProtected && !settings.bypassPremium) {
      setResource({
        url: trimmed,
        originalUrl: trimmed,
        domain,
        filename,
        size: null,
        type,
        status: 'protected',
        statusMessage: protection.reason || 'Recurso requer assinatura ou autorização.',
        isProtected: true,
      });
      setAppState('identified');
      return;
    }

    // 3. Verificação de tamanho (HEAD)
    let detectedSize: number | null = null;
    try {
      const res = await fetch(trimmed, { method: 'HEAD', mode: 'cors' });
      const len = res.headers.get('content-length');
      if (len) {
        const parsed = parseInt(len, 10);
        if (!isNaN(parsed) && parsed > 0) detectedSize = parsed;
      }
    } catch {
      // Ignora erro de CORS em HEAD
    }

    const identifiedResource: ResourceDetails = {
      url: trimmed,
      originalUrl: trimmed,
      domain,
      filename,
      size: detectedSize,
      type,
      status: 'available',
      statusMessage: settings.bypassPremium
        ? 'Bypass Ativado ⚡ Download Liberado'
        : 'Disponível',
      isProtected: false,
    };

    setResource(identifiedResource);
    setAppState('identified');

    if (settings.autoDownload) {
      triggerDownload(identifiedResource);
    }
  };

  const handleCopyDirectUrl = (textToCopy: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const handleOpenInBrowser = (openUrl: string) => {
    window.open(openUrl, '_blank', 'noopener,noreferrer');
  };

  const handleReset = () => {
    setUrl('');
    setAppState('idle');
    setResource(null);
    setProgress(null);
    setErrorMessage(null);
  };

  const handleClearHistory = () => {
    if (window.confirm('Tem certeza de que deseja limpar todo o histórico?')) {
      setHistory([]);
      localStorage.removeItem('7mgfc_history');
    }
  };

  const handleRemoveHistoryItem = (id: string) => {
    const updated = history.filter((item) => item.id !== id);
    saveHistory(updated);
  };

  const handleExportHistory = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(history, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `7mgfc_historico_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const filteredHistory = history.filter(
    (item) =>
      item.filename.toLowerCase().includes(historySearch.toLowerCase()) ||
      item.url.toLowerCase().includes(historySearch.toLowerCase())
  );

  // Se não autenticado, renderiza a tela de login/cadastro
  if (!user) {
    return <AuthView onLoginSuccess={(loggedInUser) => setUser(loggedInUser)} />;
  }

  const usagePercent =
    usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;

  return (
    <div className="min-h-screen bg-[#050505] text-[#F5F5F5] font-sans flex flex-col justify-between selection:bg-[#E50914] selection:text-white">
      {/* Background glowing decorations */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] rounded-full bg-[#E50914]/10 blur-[160px] animate-pulse-glow" />
        <div className="absolute bottom-10 left-10 w-[500px] h-[500px] rounded-full bg-purple-600/10 blur-[170px] animate-pulse-glow" />
      </div>

      {/* Grid line overlay */}
      <div className="fixed inset-0 bg-grid-pattern pointer-events-none opacity-30 z-0" />

      {/* ==================== HEADER ==================== */}
      <header className="relative z-10 sticky top-0 border-b border-white/10 bg-[#08080c]/90 backdrop-blur-xl px-4 sm:px-8 py-3.5 shadow-xl">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Logo & Branding */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src="/logo.png"
                alt="Logo 7MGFC"
                className="w-10 h-10 rounded-xl border border-[#E50914]/50 shadow-md shadow-[#E50914]/30 object-cover"
              />
              <span className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#08080c]" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black tracking-wider text-white">7MGFC</span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-[#E50914]/20 text-[#E50914] border border-[#E50914]/40">
                  WEB PRO
                </span>
                {settings.bypassPremium && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                    ⚡ BYPASS
                  </span>
                )}
              </div>
              <p className="text-xs text-[#80808e] font-medium">
                Download Manager & Recursos Oficiais
              </p>
            </div>
          </div>

          {/* User Capsule & Navigation */}
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 w-full md:w-auto">
            {/* Usage Quota Pill */}
            <div
              className="flex items-center gap-3 bg-[#111118] border border-white/10 px-3.5 py-1.5 rounded-xl shadow-inner cursor-pointer hover:border-white/20 transition-colors"
              onClick={() => setActiveTab('dashboard')}
              title="Clique para ver o painel completo de uso"
            >
              <div className="flex flex-col text-right">
                <span className="text-[10px] text-[#80808e] uppercase font-semibold">Hoje</span>
                <span className="text-xs font-bold text-white">
                  {usage.used}{' '}
                  <span className="text-[#666]">/</span>{' '}
                  <span className="text-[#E50914]">{usage.limit}</span>
                </span>
              </div>
              <div className="w-12 h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    usagePercent >= 90 ? 'bg-red-500' : 'bg-[#E50914]'
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1 bg-[#111118] p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setActiveTab('downloader')}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'downloader'
                    ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/25'
                    : 'text-[#80808e] hover:text-white'
                }`}
              >
                ⚡ Baixar
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'dashboard'
                    ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/25'
                    : 'text-[#80808e] hover:text-white'
                }`}
              >
                📊 Painel
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'history'
                    ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/25'
                    : 'text-[#80808e] hover:text-white'
                }`}
              >
                📜 Histórico ({history.length})
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/25'
                    : 'text-[#80808e] hover:text-white'
                }`}
              >
                ⚙️ Ajustes
              </button>

              {user.role === 'admin' && (
                <a
                  href="/ceo/index.html"
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-purple-950/40 text-purple-300 border border-purple-500/30 hover:bg-purple-900/50 transition-all cursor-pointer flex items-center gap-1"
                  title="Abrir Painel Administrativo do CEO"
                >
                  👑 Admin
                </a>
              )}

              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-bold px-2.5 py-1.5 rounded-lg text-[#80808e] hover:text-[#E50914] transition-colors ml-1 cursor-pointer"
                title="Sair do sistema"
              >
                Sair
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* ==================== MAIN CONTENT ==================== */}
      <main className="relative z-10 flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-8 flex flex-col justify-start">
        {/* ==================== TAB 1: DOWNLOADER ==================== */}
        {activeTab === 'downloader' && (
          <div className="flex flex-col gap-6 animate-fadeIn">
            {/* Input Card */}
            <div className="glass-panel p-6 sm:p-8 rounded-2xl shadow-2xl border border-white/10 relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    Insira o Link do Arquivo
                    <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/30">
                      Direto & Oficial
                    </span>
                  </h2>
                  <p className="text-xs text-[#80808e] mt-0.5">
                    Cole o link do recurso do Magnific, Freepik ou URL direta para baixar
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className="text-xs font-bold text-[#E50914] hover:text-[#ff3843] bg-[#E50914]/10 hover:bg-[#E50914]/20 border border-[#E50914]/30 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                    title="Colar automaticamente o conteúdo da sua área de transferência"
                  >
                    <span>📋 Colar Link</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => updateSetting('bypassPremium', !settings.bypassPremium)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer border ${
                      settings.bypassPremium
                        ? 'bg-amber-400/15 text-amber-300 border-amber-400/40 shadow-sm shadow-amber-400/10'
                        : 'bg-white/5 text-[#80808e] border-white/10 hover:text-white'
                    }`}
                    title="Alternar modo de bypass para arquivos premium"
                  >
                    <span>⚡ Bypass: {settings.bypassPremium ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleProcessUrl} className="flex flex-col gap-4">
                <div className="relative">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.magnific.com/... ou https://www.freepik.com/..."
                    disabled={appState === 'processing'}
                    className="w-full bg-[#111118] border border-white/15 focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] text-sm text-white px-4 py-3.5 rounded-xl outline-none transition-all placeholder-[#555]"
                  />
                  {url && (
                    <button
                      type="button"
                      onClick={() => setUrl('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-[#777] hover:text-white bg-white/5 hover:bg-white/10 p-1 rounded-md"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <button
                    type="submit"
                    disabled={appState === 'processing'}
                    className="w-full sm:w-auto flex-1 bg-[#E50914] hover:bg-[#ff1f2d] active:bg-[#c40811] text-white text-xs font-bold py-3.5 px-6 rounded-xl uppercase tracking-wider transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-lg shadow-[#E50914]/25"
                  >
                    {appState === 'processing' ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>PROCESSANDO RECURSO...</span>
                      </>
                    ) : (
                      <span>🔍 IDENTIFICAR & LIBERAR DOWNLOAD</span>
                    )}
                  </button>

                  {resource && (
                    <button
                      type="button"
                      onClick={handleReset}
                      className="w-full sm:w-auto px-4 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-[#a0a0aa] transition-colors"
                    >
                      Limpar
                    </button>
                  )}
                </div>

                {/* Status line */}
                <div className="flex items-center gap-2 text-xs text-[#80808e] pt-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      appState === 'processing'
                        ? 'bg-amber-400 animate-pulse'
                        : appState === 'error'
                        ? 'bg-[#E50914]'
                        : appState === 'identified'
                        ? 'bg-emerald-400'
                        : 'bg-[#555]'
                    }`}
                  />
                  <span>
                    {appState === 'processing'
                      ? 'Localizando recurso e validando endpoint oficial...'
                      : appState === 'error'
                      ? errorMessage || 'Erro ao processar URL'
                      : appState === 'identified'
                      ? 'Recurso identificado e pronto para baixar!'
                      : 'Pronto para processar qualquer link compatível'}
                  </span>
                </div>
              </form>
            </div>

            {/* Error Message Alert */}
            {appState === 'error' && errorMessage && (
              <div className="p-4 rounded-xl bg-red-950/40 border border-[#E50914]/50 text-red-200 text-xs flex items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="text-base">⚠️</span>
                  <span>{errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAppState('idle')}
                  className="text-red-400 hover:text-white font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {/* IDENTIFIED RESOURCE CARD */}
            {appState === 'identified' && resource && (
              <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 flex flex-col gap-6 shadow-2xl animate-fadeIn">
                {/* Result header banner */}
                <div
                  className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                    resource.isProtected && !settings.bypassPremium
                      ? 'bg-red-950/30 border-[#E50914]/50'
                      : 'bg-emerald-950/30 border-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                        resource.isProtected && !settings.bypassPremium
                          ? 'bg-[#E50914] text-white'
                          : 'bg-emerald-500 text-black'
                      }`}
                    >
                      {resource.isProtected && !settings.bypassPremium ? '✕' : '✓'}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">
                        {resource.isProtected && !settings.bypassPremium
                          ? 'Arquivo Protegido no Site Oficial'
                          : 'Arquivo Original Localizado & Liberado!'}
                      </h4>
                      <p className="text-xs text-[#a0a0aa] mt-0.5">{resource.statusMessage}</p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md tracking-wider ${
                      resource.isProtected && !settings.bypassPremium
                        ? 'bg-[#E50914]/20 text-[#E50914] border border-[#E50914]/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {resource.isProtected && !settings.bypassPremium ? 'BLOQUEADO' : 'LIBERADO'}
                  </span>
                </div>

                {/* Resource Info Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Left Column: Preview or Info Banner */}
                  <div className="md:col-span-1 bg-[#101018] rounded-xl p-4 border border-white/5 flex flex-col items-center justify-center text-center">
                    {resource.previewImageUrl ? (
                      <div className="relative w-full h-44 rounded-lg overflow-hidden border border-white/10 bg-black mb-3">
                        <img
                          src={resource.previewImageUrl}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 left-2 bg-black/80 px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase">
                          {resource.platform || 'Recurso'}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-40 rounded-lg bg-gradient-to-br from-[#181824] to-[#0d0d14] border border-white/10 flex flex-col items-center justify-center gap-2 mb-3">
                        <span className="text-3xl">📦</span>
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          {resource.type} ORIGINAL
                        </span>
                        <span className="text-[10px] text-[#777]">{resource.domain}</span>
                      </div>
                    )}

                    <span className="text-xs font-bold text-white break-all line-clamp-2 px-1">
                      {resource.filename}
                    </span>
                  </div>

                  {/* Right Column: Metadata Details */}
                  <div className="md:col-span-2 flex flex-col justify-between gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="p-3 bg-[#111118] rounded-xl border border-white/5">
                        <span className="text-[10px] text-[#80808e] uppercase font-semibold block">
                          Formato
                        </span>
                        <span className="text-sm font-bold text-[#E50914]">{resource.type}</span>
                      </div>

                      <div className="p-3 bg-[#111118] rounded-xl border border-white/5">
                        <span className="text-[10px] text-[#80808e] uppercase font-semibold block">
                          Plataforma
                        </span>
                        <span className="text-sm font-bold text-white capitalize">
                          {resource.domain}
                        </span>
                      </div>

                      <div className="p-3 bg-[#111118] rounded-xl border border-white/5">
                        <span className="text-[10px] text-[#80808e] uppercase font-semibold block">
                          ID Oficial
                        </span>
                        <span className="text-sm font-bold text-amber-400 font-mono">
                          {resource.resourceId ? `#${resource.resourceId}` : 'Detectado'}
                        </span>
                      </div>
                    </div>

                    {/* CDN Token details if any */}
                    {resource.cdnDetails && (
                      <div className="p-3 bg-[#111118] rounded-xl border border-purple-500/20 text-xs">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-bold text-purple-400">⚡ Link CDN Oficial</span>
                          <span className="text-[#777] font-mono truncate max-w-[200px]">
                            {resource.cdnDetails.cdnHost}
                          </span>
                        </div>
                        <div className="flex gap-4 text-[11px] text-[#aaa]">
                          <span>
                            Cluster: <strong>#{resource.cdnDetails.clusterId || '1323'}</strong>
                          </span>
                          <span>
                            Formato: <strong>#{resource.cdnDetails.formatCode || '2'}</strong>
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={() => triggerDownload(resource)}
                        className="w-full bg-[#E50914] hover:bg-[#ff1f2d] active:bg-[#c40811] text-white font-extrabold py-3.5 px-6 rounded-xl uppercase tracking-wider text-xs transition-all shadow-xl shadow-[#E50914]/30 flex items-center justify-center gap-2.5 cursor-pointer"
                      >
                        <span className="text-base">⬇</span>
                        <span>BAIXAR ARQUIVO OFICIAL AGORA</span>
                      </button>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyDirectUrl(resource.url)}
                          className="bg-[#14141c] hover:bg-[#1c1c28] border border-white/10 text-white text-xs font-semibold py-2.5 px-3 rounded-xl transition-colors cursor-pointer text-center"
                        >
                          {copied ? '✓ Link Copiado!' : '🔗 Copiar Link'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleOpenInBrowser(resource.pageUrl || resource.url)
                          }
                          className="bg-[#14141c] hover:bg-[#1c1c28] border border-white/10 text-white text-xs font-semibold py-2.5 px-3 rounded-xl transition-colors cursor-pointer text-center"
                        >
                          ↗ Abrir Oficial
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DOWNLOAD PROGRESS CARD */}
            {appState === 'downloading' && (
              <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 flex flex-col gap-4 shadow-2xl animate-fadeIn">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#E50914] animate-ping" />
                    <span className="text-sm font-bold text-white uppercase tracking-wider">
                      BAIXANDO ARQUIVO...
                    </span>
                  </div>
                  <span className="text-sm font-mono font-bold text-[#E50914]">
                    {progress?.percent || 0}%
                  </span>
                </div>

                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-[#E50914] to-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${progress?.percent || 0}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-[#80808e] font-mono">
                  <span>
                    {formatBytes(progress?.receivedBytes || 0)} /{' '}
                    {formatBytes(progress?.totalBytes || resource?.size || 0)}
                  </span>
                  <span>{formatSpeed(progress?.speed || 0)}</span>
                </div>
              </div>
            )}

            {/* DOWNLOAD COMPLETED CARD */}
            {appState === 'completed' && (
              <div className="glass-panel p-8 rounded-2xl border border-emerald-500/40 text-center flex flex-col items-center gap-4 shadow-2xl animate-fadeIn">
                <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 flex items-center justify-center text-2xl font-bold">
                  ✓
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white uppercase tracking-wide">
                    DOWNLOAD CONCLUÍDO!
                  </h3>
                  <p className="text-xs text-[#a0a0aa] mt-1 max-w-md">
                    O arquivo <strong>{resource?.filename}</strong> foi processado e iniciado no seu
                    navegador. Verifique sua pasta de downloads.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="bg-[#E50914] hover:bg-[#ff1f2d] text-white text-xs font-bold py-2.5 px-6 rounded-xl transition-all cursor-pointer shadow-lg shadow-[#E50914]/25"
                  >
                    Baixar Outro Arquivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="bg-white/5 hover:bg-white/10 text-white text-xs font-semibold py-2.5 px-4 rounded-xl transition-all cursor-pointer"
                  >
                    Ver no Histórico
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 2: DASHBOARD ==================== */}
        {activeTab === 'dashboard' && (
          <div className="flex flex-col gap-6 animate-fadeIn">
            {/* Header section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  Painel de Controle do Usuário
                </h2>
                <p className="text-xs text-[#80808e] mt-1">
                  Resumo de uso diário, limites e validade da conta
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#aaa] font-medium">
                  {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date())}
                </span>
              </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col gap-2">
                <span className="text-xs font-semibold text-[#80808e] uppercase tracking-wider">
                  Downloads Utilizados Hoje
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-black text-white">{usage.used}</span>
                  <span className="text-xs text-[#666]">arquivos</span>
                </div>
                <span className="text-[11px] text-[#888]">
                  Registrados no Supabase para hoje
                </span>
              </div>

              <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col gap-2">
                <span className="text-xs font-semibold text-[#80808e] uppercase tracking-wider">
                  Downloads Restantes
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-black text-emerald-400">
                    {usage.remaining}
                  </span>
                  <span className="text-xs text-[#666]">disponíveis</span>
                </div>
                <span className="text-[11px] text-emerald-400/80">
                  Renovação diária às 00:00 UTC
                </span>
              </div>

              <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col gap-2">
                <span className="text-xs font-semibold text-[#80808e] uppercase tracking-wider">
                  Limite Diário Total
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-black text-[#E50914]">
                    {usage.limit}
                  </span>
                  <span className="text-xs text-[#666]">por dia</span>
                </div>
                <span className="text-[11px] text-[#888]">
                  Plano VIP 7MGFC
                </span>
              </div>
            </div>

            {/* Progress Gauge Card */}
            <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Uso da Quota Diária ({usagePercent}%)
                </span>
                <span className="text-xs font-bold text-[#80808e]">
                  {usage.used} de {usage.limit}
                </span>
              </div>

              <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    usagePercent >= 90
                      ? 'bg-red-500'
                      : usagePercent >= 60
                      ? 'bg-amber-400'
                      : 'bg-gradient-to-r from-[#E50914] to-red-500'
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <p className="text-xs text-[#80808e]">
                {usage.remaining > 0
                  ? `Você ainda pode realizar ${usage.remaining} download(s) com velocidade total hoje.`
                  : 'Você atingiu o limite diário de downloads para o dia de hoje.'}
              </p>
            </div>

            {/* Account Details Card */}
            <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 flex flex-col gap-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-white/10 pb-3">
                Informações da Sua Conta
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="flex justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-[#80808e]">Usuário</span>
                  <span className="font-bold text-white">{user.username}</span>
                </div>

                <div className="flex justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-[#80808e]">Nível de Acesso</span>
                  <span className="font-bold text-[#E50914] uppercase">
                    {user.role === 'admin' ? '👑 Administrador' : '⭐ Membro VIP'}
                  </span>
                </div>

                <div className="flex justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-[#80808e]">Status da Conta</span>
                  <span className="font-bold text-emerald-400">Ativo</span>
                </div>

                <div className="flex justify-between p-3 rounded-xl bg-white/5">
                  <span className="text-[#80808e]">Validade do Acesso</span>
                  <span className="font-bold text-white">
                    {accountDetails?.expires_at
                      ? new Date(accountDetails.expires_at).toLocaleDateString('pt-BR')
                      : 'Vitalício'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: HISTÓRICO ==================== */}
        {activeTab === 'history' && (
          <div className="flex flex-col gap-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-extrabold text-white">Histórico de Downloads</h2>
                <p className="text-xs text-[#80808e] mt-1">
                  Arquivos baixados por você neste dispositivo ({history.length} no total)
                </p>
              </div>

              {history.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportHistory}
                    className="text-xs font-semibold px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-colors cursor-pointer"
                  >
                    📥 Exportar JSON
                  </button>

                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="text-xs font-semibold px-3 py-2 rounded-xl bg-red-950/30 hover:bg-red-950/50 border border-red-500/30 text-red-300 transition-colors cursor-pointer"
                  >
                    Limpar Histórico
                  </button>
                </div>
              )}
            </div>

            {/* Search Input */}
            {history.length > 0 && (
              <div className="relative">
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Pesquisar por nome ou link..."
                  className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder-[#555] focus:outline-none focus:border-[#E50914] transition-colors"
                />
              </div>
            )}

            {/* List */}
            {filteredHistory.length === 0 ? (
              <div className="glass-panel p-12 rounded-2xl text-center text-[#80808e] flex flex-col items-center gap-3">
                <span className="text-4xl">📭</span>
                <p className="text-sm font-medium">
                  {history.length === 0
                    ? 'Nenhum download registrado ainda.'
                    : 'Nenhum resultado encontrado para a busca.'}
                </p>
                {history.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('downloader')}
                    className="mt-2 text-xs font-bold text-[#E50914] hover:underline"
                  >
                    Ir para o Downloader e baixar agora →
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredHistory.map((item) => (
                  <div
                    key={item.id}
                    className="glass-panel p-4 rounded-xl border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-white/20 transition-colors"
                  >
                    <div className="flex items-center gap-3 truncate">
                      <div className="w-10 h-10 rounded-lg bg-[#E50914]/15 border border-[#E50914]/30 text-[#E50914] flex items-center justify-center font-bold text-xs shrink-0">
                        {item.type || 'FILE'}
                      </div>
                      <div className="truncate">
                        <h4 className="text-xs font-bold text-white truncate" title={item.filename}>
                          {item.filename}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-[#80808e] mt-0.5">
                          <span>{formatDate(item.date)}</span>
                          <span>•</span>
                          <span>{formatBytes(item.size)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyDirectUrl(item.url)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white transition-colors cursor-pointer"
                        title="Copiar URL"
                      >
                        Copiar
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveHistoryItem(item.id)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-colors cursor-pointer"
                        title="Remover este item"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 4: CONFIGURAÇÕES ==================== */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-6 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-white">Configurações do Sistema</h2>
                <p className="text-xs text-[#80808e] mt-1">
                  Preferências de download, bypass e limites locais
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetSettings}
                className="text-xs font-semibold text-[#80808e] hover:text-[#E50914] transition-colors"
              >
                Restaurar Padrões
              </button>
            </div>

            <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-white/10 flex flex-col gap-6">
              {/* Bypass Toggle */}
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                    ⚡ Bypass Automático de Recursos Premium
                  </h4>
                  <p className="text-xs text-[#80808e] mt-0.5">
                    Libera automaticamente downloads restritos do Magnific e Freepik
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSetting('bypassPremium', !settings.bypassPremium)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 cursor-pointer ${
                    settings.bypassPremium ? 'bg-[#E50914]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                      settings.bypassPremium ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Auto Download Toggle */}
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div>
                  <h4 className="text-sm font-bold text-white">Download Automático</h4>
                  <p className="text-xs text-[#80808e] mt-0.5">
                    Inicia o download imediatamente após validar a URL
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSetting('autoDownload', !settings.autoDownload)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 cursor-pointer ${
                    settings.autoDownload ? 'bg-[#E50914]' : 'bg-white/15'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                      settings.autoDownload ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Subfolder Preference */}
              <div className="flex flex-col gap-2 pb-4 border-b border-white/5">
                <label className="text-sm font-bold text-white">Subpasta / Prefixo Padrão</label>
                <input
                  type="text"
                  value={settings.subfolder}
                  onChange={(e) => updateSetting('subfolder', e.target.value)}
                  placeholder="7MGFC"
                  className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-[#555] focus:outline-none focus:border-[#E50914]"
                />
                <span className="text-[11px] text-[#777]">
                  Usado na organização e identificação dos arquivos baixados.
                </span>
              </div>

              {/* History Limit */}
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div>
                  <h4 className="text-sm font-bold text-white">Limite do Histórico</h4>
                  <p className="text-xs text-[#80808e] mt-0.5">
                    Quantidade máxima de itens salvos localmente
                  </p>
                </div>
                <select
                  value={settings.maxHistoryItems}
                  onChange={(e) => updateSetting('maxHistoryItems', Number(e.target.value))}
                  className="bg-[#111118] border border-white/10 text-xs text-white px-3 py-2 rounded-xl focus:outline-none focus:border-[#E50914]"
                >
                  <option value={15}>15 itens</option>
                  <option value={30}>30 itens</option>
                  <option value={50}>50 itens</option>
                  <option value={100}>100 itens</option>
                </select>
              </div>

              {/* API Key */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-white">
                    Chave de API Oficial Magnific / Freepik (Opcional)
                  </label>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">
                    PRO
                  </span>
                </div>
                <input
                  type="password"
                  value={settings.magnificApiKey || ''}
                  onChange={(e) => updateSetting('magnificApiKey', e.target.value)}
                  placeholder="Insira sua chave de API para endpoints oficiais"
                  className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-[#555] focus:outline-none focus:border-[#E50914]"
                />
                <span className="text-[11px] text-[#777]">
                  Se informada, será enviada nas requisições diretas aos endpoints da API.
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================== FOOTER ==================== */}
      <footer className="relative z-10 border-t border-white/10 bg-[#08080c]/80 backdrop-blur-md px-4 sm:px-8 py-4 text-xs text-[#70707c] mt-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white">7MGFC Web Core</span>
            <span>•</span>
            <span>100% Web Nativo • Sem dependência de extensão</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[#E50914] font-bold">v2.0 Web</span>
            <span>•</span>
            <span>Supabase Ativo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}