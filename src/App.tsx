import { useState, useEffect, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import type {
  AppState,
  ResourceDetails,
  DownloadProgress,
  HistoryRecord,
  AppSettings,
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
import { extractFromActiveTab } from './utils/tabExtractor';
import { fetchUserDailyUsage } from './utils/supabase';

type ActiveTab = 'downloader' | 'history' | 'settings';

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
  const [user, setUser] = useState<any>(null);
  const [usage, setUsage] = useState({ used: 0, limit: 30, remaining: 30 });

  const pollIntervalRef = useRef<number | null>(null);

  // Carrega histórico e configurações do storage local
  const loadData = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['history', 'settings'], (res) => {
        if (Array.isArray(res.history)) {
          setHistory(res.history as HistoryRecord[]);
        }

        if (res.settings) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...res.settings,
          });
        }
      });
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auth check para o ambiente web
  useEffect(() => {
    const savedUser = localStorage.getItem('7mgfc_user');

    if (!savedUser) {
      window.location.href = '/index.html';
      return;
    }

    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setUser(u);
        
        // Fetch limits
        const userId = u.username || u.id;
        fetchUserDailyUsage(userId).then(data => {
          const limit = u.daily_limit || 30;
          setUsage({
            used: data.used,
            limit: limit,
            remaining: Math.max(0, limit - data.used)
          });
        });
      } catch (err) {}
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('7mgfc_user');
    window.location.href = '/index.html';
  }, []);

  // Limpa intervalo de polling ao desmontar
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Monitora progresso do download ativo
  const startProgressPolling = useCallback(
    (downloadId: number) => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }

      pollIntervalRef.current = window.setInterval(() => {
        if (
          typeof chrome === 'undefined' ||
          !chrome.runtime?.sendMessage
        ) {
          return;
        }

        chrome.runtime.sendMessage(
          {
            action: 'getDownloadProgress',
            downloadId,
          },
          (response) => {
            if (response?.success && response.data) {
              const data =
                response.data as DownloadProgress;

              setProgress(data);

              if (data.state === 'complete') {
                if (pollIntervalRef.current) {
                  window.clearInterval(
                    pollIntervalRef.current
                  );

                  pollIntervalRef.current = null;
                }

                setAppState('completed');
                loadData();
              } else if (
                data.state === 'interrupted'
              ) {
                if (pollIntervalRef.current) {
                  window.clearInterval(
                    pollIntervalRef.current
                  );

                  pollIntervalRef.current = null;
                }

                setAppState('error');

                setErrorMessage(
                  'O download foi interrompido pelo navegador.'
                );

                loadData();
              }
            }
          }
        );
      }, 400);
    },
    [loadData]
  );

  // Download do arquivo oficial via Chrome Downloads API
  const triggerDownload = useCallback(
    (targetResource: ResourceDetails) => {
      if (targetResource.isProtected) {
        setErrorMessage(
          'Este recurso requer autorização da plataforma ou uma URL CDN válida fornecida pela sessão autenticada.'
        );

        setAppState('error');

        return;
      }

      if (
        !targetResource.url ||
        typeof targetResource.url !== 'string'
      ) {
        setErrorMessage(
          'Nenhuma URL de download autorizada foi encontrada.'
        );

        setAppState('error');

        return;
      }

      setAppState('preparing');
      setErrorMessage(null);

      if (
        typeof chrome === 'undefined' ||
        !chrome.runtime?.sendMessage
      ) {
        setErrorMessage(
          'Ambiente Chrome Downloads indisponível.'
        );

        setAppState('error');

        return;
      }

      chrome.runtime.sendMessage(
        {
          action: 'startDownload',
          url: targetResource.url,
          filename: targetResource.filename,
          type: targetResource.type,
          conflictAction: settings.conflictAction,
          subfolder: settings.subfolder,
          apiKey: settings.magnificApiKey,
          alternativeUrls: targetResource.alternativeDownloadUrls,
        },
        (res) => {
          if (!res?.success || !res.downloadId) {
            setAppState('error');

            setErrorMessage(
              res?.error ||
                'Não foi possível iniciar o download do arquivo oficial.'
            );

            return;
          }

          setAppState('downloading');

          setProgress({
            downloadId: res.downloadId,
            receivedBytes: 0,
            totalBytes: targetResource.size || 0,
            percent: 0,
            speed: 0,
            state: 'in_progress',
          });

          startProgressPolling(res.downloadId);
        }
      );
    },
    [settings, startProgressPolling]
  );

  // Processamento da URL
  const handleProcessUrl = async (
    e?: FormEvent,
    directUrl?: string
  ) => {
    if (e) {
      e.preventDefault();
    }

    const targetUrl =
      typeof directUrl === 'string'
        ? directUrl
        : url;

    const trimmed = targetUrl.trim();

    if (!trimmed) {
      setErrorMessage(
        'Cole uma URL para processar.'
      );

      setAppState('error');

      return;
    }

    if (!isValidUrl(trimmed)) {
      setErrorMessage(
        'URL inválida. Verifique o link e tente novamente.'
      );

      setAppState('error');

      return;
    }

    setErrorMessage(null);
    setAppState('processing');
    setResource(null);
    setProgress(null);

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );

    // ============================================================
    // 1. MAGNIFIC / FREEPIK
    // ============================================================

    const magnificRes =
      parseMagnificOrFreepik(trimmed);

    if (magnificRes) {
      let liveMeta: Awaited<
        ReturnType<typeof extractFromActiveTab>
      > = null;

      try {
        liveMeta =
          await extractFromActiveTab();
      } catch {
        liveMeta = null;
      }

      /*
       * A página pode disponibilizar uma URL CDN assinada
       * para a sessão atual.
       *
       * Só utilizamos essa URL quando:
       *
       * 1. é uma URL CDN reconhecida;
       * 2. possui token;
       * 3. o token ainda não expirou.
       *
       * Não criamos nem alteramos tokens.
       */
      const liveCdnUrl =
        liveMeta?.activeCdnUrl;

      let resolvedDownload =
        magnificRes;

      if (liveCdnUrl) {
        const liveCdnResource =
          parseMagnificOrFreepik(
            liveCdnUrl
          );

        if (
          liveCdnResource?.isDirectCdnUrl &&
          liveCdnResource.cdnDetails?.token &&
          !liveCdnResource.cdnDetails
            .isExpired
        ) {
          resolvedDownload =
            liveCdnResource;
        }
      }

      const isPremium =
        magnificRes.tier === 'premium' ||
        Boolean(
          liveMeta?.isPremiumPage
        );

      /*
       * O estado de proteção é determinado pelo
       * recurso realmente resolvido.
       */
      let isProtected =
        resolvedDownload.isProtected;

      let statusMessage =
        isProtected
          ? (
              resolvedDownload.isDirectCdnUrl &&
              resolvedDownload.cdnDetails
                ?.isExpired
            )
            ? 'Token CDN expirado • Faça uma nova autenticação na plataforma'
            : isPremium
              ? 'Arquivo Premium Oficial • Requer autenticação e autorização da plataforma'
              : resolvedDownload.statusMessage
          : liveCdnUrl
            ? 'URL CDN oficial assinada encontrada na sessão atual • Download autorizado'
            : resolvedDownload.statusMessage;

      if (settings.bypassPremium && isProtected) {
        isProtected = false;
        statusMessage = 'Bypass Ativado ⚡ Download Oficial Liberado';
      }

      const identifiedResource:
        ResourceDetails = {
        url:
          resolvedDownload.downloadUrl,

        originalUrl:
          trimmed,

        domain:
          magnificRes.platform === 'magnific'
            ? 'magnific.com'
            : 'freepik.com',

        filename:
          resolvedDownload.cleanFilename,

        size: null,

        type:
          resolvedDownload.fileType,

        status:
          isProtected
            ? 'protected'
            : 'available',

        statusMessage,

        isProtected,

        platform:
          magnificRes.platform,

        resourceId:
          magnificRes.resourceId,

        category:
          resolvedDownload.category,

        slug:
          resolvedDownload.slug,

        isPremium,

        isDirectCdnUrl:
          resolvedDownload.isDirectCdnUrl,

        alternativeDownloadUrls:
          resolvedDownload.alternativeDownloadUrls,

        cdnDetails:
          resolvedDownload.cdnDetails,

        pageUrl:
          magnificRes.pageUrl,

        previewImageUrl:
          liveMeta?.previewImageUrl ||
          liveMeta?.mainImageDataUrl,

        author:
          liveMeta?.author ||
          magnificRes.authorId,

        pageTitle:
          liveMeta?.pageTitle,

        tokenInfo:
          resolvedDownload.cdnDetails
            ? {
                token:
                  resolvedDownload.cdnDetails
                    .token,

                expiresAt:
                  resolvedDownload.cdnDetails
                    .tokenExpiresAt,

                isExpired:
                  resolvedDownload.cdnDetails
                    .isExpired,

                hmac:
                  resolvedDownload.cdnDetails
                    .hmac,
              }
            : undefined,
      };

      setResource(
        identifiedResource
      );

      setAppState('identified');

      /*
       * Download automático somente quando
       * existe uma URL que não está protegida.
       */
      if (
        settings.autoDownload &&
        !isProtected
      ) {
        triggerDownload(
          identifiedResource
        );
      }

      return;
    }

    // ============================================================
    // 2. LINKS GENÉRICOS
    // ============================================================

    const protection =
      isProtectedResource(trimmed);

    const domain =
      extractDomain(trimmed);

    const filename =
      extractFilename(trimmed);

    const type =
      detectFileType(filename);

    /*
     * Bypass Premium Check para Links Genéricos
     */
    if (protection.isProtected && !settings.bypassPremium) {
      setResource({
        url: trimmed,

        originalUrl: trimmed,

        domain,

        filename,

        size: null,

        type,

        status: 'protected',

        statusMessage:
          protection.reason ||
          'Recurso requer assinatura ou autorização.',

        isProtected: true,
      });

      setAppState('identified');

      return;
    }

    // ============================================================
    // 3. HEAD PARA VERIFICAR TAMANHO
    // ============================================================

    let detectedSize:
      number | null = null;

    try {
      const response =
        await fetch(trimmed, {
          method: 'HEAD',
          mode: 'cors',
        });

      const len =
        response.headers.get(
          'content-length'
        );

      if (len) {
        const parsedLen =
          parseInt(len, 10);

        if (
          !isNaN(parsedLen) &&
          parsedLen > 0
        ) {
          detectedSize =
            parsedLen;
        }
      }
    } catch {
      /*
       * Ignora falhas de CORS no HEAD.
       * O Chrome Downloads pode realizar
       * o download posteriormente.
       */
    }

    const identifiedResource:
      ResourceDetails = {
      url: trimmed,

      originalUrl: trimmed,

      domain,

      filename,

      size: detectedSize,

      type,

      status: 'available',

      statusMessage: 'Disponível',

      isProtected: false,
    };

    setResource(
      identifiedResource
    );

    setAppState('identified');

    if (settings.autoDownload) {
      triggerDownload(
        identifiedResource
      );
    }
  };

  // Captura URL da aba ativa
  const handleCaptureActiveTab =
    () => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.tabs?.query
      ) {
        chrome.tabs.query(
          {
            active: true,
            currentWindow: true,
          },
          (tabs) => {
            const activeTab =
              tabs?.[0];

            if (
              activeTab?.url &&
              isValidUrl(
                activeTab.url
              )
            ) {
              setUrl(
                activeTab.url
              );

              handleProcessUrl(
                undefined,
                activeTab.url
              );
            } else {
              setErrorMessage(
                'Nenhuma URL válida detectada na aba ativa.'
              );

              setAppState(
                'error'
              );
            }
          }
        );
      } else {
        setErrorMessage(
          'Captura disponível ao executar no Chrome.'
        );

        setAppState('error');
      }
    };

  // Copiar URL
  const handleCopyDirectUrl =
    (textToCopy: string) => {
      if (
        navigator?.clipboard
          ?.writeText
      ) {
        navigator.clipboard
          .writeText(textToCopy)
          .then(() => {
            setCopied(true);

            setTimeout(
              () =>
                setCopied(false),
              2000
            );
          });
      }
    };

  // Abrir URL no navegador
  const handleOpenInBrowser =
    (openUrl: string) => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.tabs?.create
      ) {
        chrome.tabs.create({
          url: openUrl,
        });
      } else {
        window.open(
          openUrl,
          '_blank'
        );
      }
    };

  // Reset
  const handleReset =
    () => {
      setUrl('');
      setAppState('idle');
      setResource(null);
      setProgress(null);
      setErrorMessage(null);
    };

  // ============================================================
  // HISTÓRICO
  // ============================================================

  const handleClearHistory =
    () => {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.local
      ) {
        chrome.storage.local.set(
          {
            history: [],
          },
          () => {
            setHistory([]);
          }
        );
      }
    };

  const handleRemoveHistoryItem =
    (id: string) => {
      const updated =
        history.filter(
          (item) =>
            item.id !== id
        );

      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.local
      ) {
        chrome.storage.local.set(
          {
            history: updated,
          },
          () => {
            setHistory(
              updated
            );
          }
        );
      }
    };

  const handleExportHistory =
    () => {
      const dataStr =
        'data:text/json;charset=utf-8,' +
        encodeURIComponent(
          JSON.stringify(
            history,
            null,
            2
          )
        );

      const a =
        document.createElement(
          'a'
        );

      a.href =
        dataStr;

      a.download =
        `7mgfc_historico_${new Date()
          .toISOString()
          .slice(0, 10)}.json`;

      a.click();
    };

  // ============================================================
  // CONFIGURAÇÕES
  // ============================================================

  const updateSetting =
    <
      K extends keyof AppSettings
    >(
      key: K,
      value: AppSettings[K]
    ) => {
      const updated = {
        ...settings,
        [key]: value,
      };

      setSettings(updated);

      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.local
      ) {
        chrome.storage.local.set({
          settings: updated,
        });
      }
    };

  const handleResetSettings =
    () => {
      setSettings(
        DEFAULT_SETTINGS
      );

      if (
        typeof chrome !== 'undefined' &&
        chrome.storage?.local
      ) {
        chrome.storage.local.set({
          settings:
            DEFAULT_SETTINGS,
        });
      }
    };

  const filteredHistory =
    history.filter(
      (item) =>
        item.filename
          .toLowerCase()
          .includes(
            historySearch
              .toLowerCase()
          ) ||
        item.url
          .toLowerCase()
          .includes(
            historySearch
              .toLowerCase()
          )
    );

  return (
    <div className="w-[390px] min-h-[500px] bg-[#050505] text-[#F5F5F5] font-sans flex flex-col justify-between border border-[#242424] select-none shadow-2xl">

      {/* HEADER */}
      <header className="px-4 py-3 border-b border-[#242424] bg-[#080808] flex items-center justify-between">

        <div className="flex items-center gap-2.5">

          <img
            src="/logo.png"
            alt="Logo 7MGFC"
            className="w-8 h-8 rounded-full border border-[#E50914]/50 shadow-sm shadow-[#E50914]/40 object-cover"
          />

          <div>
            <div className="flex items-center gap-1.5">

              <span className="text-sm font-black tracking-widest text-[#F5F5F5]">
                7MGFC
              </span>

              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#7F080E]/40 text-[#E50914] border border-[#E50914]/30">
                PRO
              </span>

            </div>

            <p className="text-[10px] text-[#777777]">
              {user ? `Olá, ${user.username}` : 'Download Manager Local'}
            </p>
          </div>

        </div>

        <div className="flex flex-col items-end gap-1.5">
          {user && (
            <div className="flex items-center gap-1 text-[9px] text-[#A0A0A0] bg-[#141414] px-1.5 py-0.5 rounded border border-[#242424]" title="Seu limite diário no sistema">
              ⬇️ Hoje:
              <span className="font-bold text-[#F5F5F5]">{usage.used}</span>
              <span className="text-[#555]">/</span>
              <span className="text-[#E50914] font-semibold">{usage.limit}</span>
            </div>
          )}

          <nav className="flex items-center gap-1 bg-[#0D0D0D] p-1 rounded-md border border-[#242424]">

          <button
            type="button"
            onClick={() =>
              setActiveTab(
                'downloader'
              )
            }
            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded transition-colors ${
              activeTab ===
              'downloader'
                ? 'bg-[#E50914] text-[#F5F5F5]'
                : 'text-[#777777] hover:text-[#F5F5F5]'
            }`}
          >
            Baixar
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab(
                'history'
              )
            }
            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded transition-colors ${
              activeTab ===
              'history'
                ? 'bg-[#E50914] text-[#F5F5F5]'
                : 'text-[#777777] hover:text-[#F5F5F5]'
            }`}
          >
            Histórico ({history.length})
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveTab(
                'settings'
              )
            }
            className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded transition-colors ${
              activeTab ===
              'settings'
                ? 'bg-[#E50914] text-[#F5F5F5]'
                : 'text-[#777777] hover:text-[#F5F5F5]'
            }`}
          >
            Ajustes
          </button>

          <button
            type="button"
            onClick={
              handleLogout
            }
            className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded transition-colors text-[#777777] hover:text-[#E50914] ml-1"
            title="Sair do sistema"
          >
            Sair
          </button>

        </nav>
        </div>
      </header>

      {/* MAIN */}
      <main className="p-4 flex-1 flex flex-col justify-center">

        {/* DOWNLOADER */}
        {activeTab ===
          'downloader' && (
          <div className="flex flex-col gap-3.5">

            {(appState ===
              'idle' ||
              appState ===
                'processing' ||
              appState ===
                'error') && (

              <form
                onSubmit={
                  handleProcessUrl
                }
                className="flex flex-col gap-3"
              >

                <div className="flex items-center justify-between">

                  <label className="text-xs text-[#777777] tracking-wide font-medium">
                    Cole o link do arquivo
                  </label>

                  <div className="flex items-center gap-2">

                    <button
                      type="button"
                      onClick={
                        handleCaptureActiveTab
                      }
                      className="text-[10px] text-[#E50914] hover:text-[#ff3b44] flex items-center gap-1 cursor-pointer font-bold tracking-tight transition-colors"
                      title="Capturar automaticamente o link da aba aberta no Chrome"
                    >
                      <span>
                        ⚡ Capturar Aba
                      </span>
                    </button>

                    {settings.autoDownload && (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Auto
                      </span>
                    )}

                  </div>

                </div>

                <div className="relative">

                  <input
                    type="text"
                    value={url}
                    onChange={(e) =>
                      setUrl(
                        e.target.value
                      )
                    }
                    placeholder="https://www.magnific.com/... ou link direto"
                    disabled={
                      appState ===
                      'processing'
                    }
                    className="w-full bg-[#0D0D0D] border border-[#242424] focus:border-[#E50914] text-xs text-[#F5F5F5] px-3 py-2.5 rounded-md outline-none transition-colors placeholder-[#444444]"
                  />

                </div>

                <button
                  type="submit"
                  disabled={
                    appState ===
                    'processing'
                  }
                  className="w-full bg-[#E50914] hover:bg-[#c40811] active:bg-[#7F080E] text-[#F5F5F5] text-xs font-bold py-2.5 rounded-md tracking-wider uppercase transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-sm shadow-[#E50914]/20"
                >
                  {appState ===
                  'processing' ? (
                    <>
                      <span className="w-3 h-3 border-2 border-[#F5F5F5] border-t-transparent rounded-full animate-spin" />
                      BUSCANDO DOWNLOAD...
                    </>
                  ) : (
                    'PROCESSAR RECURSO'
                  )}
                </button>

                <div className="flex items-center gap-1.5 text-[11px] text-[#777777] mt-0.5">

                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      appState ===
                      'processing'
                        ? 'bg-amber-400 animate-pulse'
                        : appState ===
                            'error'
                          ? 'bg-[#E50914]'
                          : 'bg-[#777777]'
                    }`}
                  />

                  <span className="truncate">

                    {appState ===
                    'processing'
                      ? 'Localizando arquivo e resolvendo endpoint...'
                      : appState ===
                          'error'
                        ? errorMessage
                        : 'Pronto para processar link'}

                  </span>

                </div>

              </form>
            )}

            {/* RECURSO IDENTIFICADO */}
            {appState ===
              'identified' &&
              resource && (

              <div className="flex flex-col gap-3.5">

                <div
                  className={`p-3 rounded-lg border flex flex-col gap-1.5 shadow-md ${
                    resource.isProtected
                      ? 'bg-[#18080A] border-[#E50914]/60 text-[#F5F5F5]'
                      : 'bg-[#06180D] border-emerald-500/60 text-[#F5F5F5]'
                  }`}
                >

                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">

                    <div className="flex items-center gap-1.5">

                      <span
                        className={`w-2 h-2 rounded-full ${
                          resource.isProtected
                            ? 'bg-[#E50914] animate-pulse'
                            : 'bg-emerald-400'
                        }`}
                      />

                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#A0A0A0]">
                        Resultado da Busca de Arquivo
                      </span>

                    </div>

                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider ${
                        resource.isProtected
                          ? 'bg-[#E50914] text-white'
                          : 'bg-emerald-500 text-black font-extrabold'
                      }`}
                    >
                      {resource.isProtected
                        ? '✕ NÃO LIBERADO'
                        : '✓ ARQUIVO LOCALIZADO'}
                    </span>

                  </div>

                  <div className="flex items-start gap-2.5 pt-1">

                    <div
                      className={`text-lg p-1.5 rounded-md flex items-center justify-center shrink-0 ${
                        resource.isProtected
                          ? 'bg-[#E50914]/15 text-[#E50914]'
                          : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >

                      {resource.isProtected ? (
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}

                    </div>

                    <div className="flex flex-col">

                      <h4 className="text-xs font-bold text-[#F5F5F5] leading-tight">

                        {resource.isProtected
                          ? resource.isPremium
                            ? 'Arquivo Premium Protegido (Download Restrito)'
                            : 'Download Bloqueado (Arquivo Protegido)'
                          : 'Arquivo Original Localizado e Pronto para Baixar'}

                      </h4>

                      <p className="text-[11px] text-[#B0B0B0] leading-snug mt-1">

                        {resource.isProtected
                          ? resource.isPremium
                            ? `O recurso oficial foi identificado no site (#${resource.resourceId || 'ID'}), mas o download exige autenticação e autorização ativa da plataforma.`
                            : 'O link foi identificado, porém requer autorização direta no site oficial.'
                          : 'O link de download direto do arquivo oficial foi validado e está liberado.'}

                      </p>

                    </div>

                  </div>

                </div>

                <div className="p-3.5 rounded-md bg-[#0D0D0D] border border-[#242424] flex flex-col gap-2.5 shadow-lg">

                  {resource.previewImageUrl && (
                    <div className="relative w-full h-36 rounded overflow-hidden border border-[#242424] bg-[#000000]">

                      <img
                        src={
                          resource.previewImageUrl
                        }
                        alt="Amostra Oficial"
                        className="w-full h-full object-cover"
                      />

                      <div className="absolute top-2 left-2 bg-[#000000]/80 backdrop-blur-sm px-2 py-0.5 rounded border border-[#333333] text-[9px] font-bold text-[#F5F5F5] uppercase tracking-wider flex items-center gap-1">

                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            resource.isPremium
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          }`}
                        />

                        {resource.isPremium
                          ? 'Recurso Premium Oficial'
                          : 'Recurso Gratuito Oficial'}

                      </div>

                    </div>
                  )}

                  <div className="flex items-start justify-between gap-2">

                    <div className="truncate">

                      <div className="flex items-center gap-1.5">

                        <span className="text-[10px] uppercase tracking-wider text-[#777777] font-semibold block">
                          RECURSO OFICIAL DETECTADO
                        </span>

                        {resource.platform ===
                          'magnific' && (

                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                              resource.isPremium
                                ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                                : 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20'
                            }`}
                          >
                            {resource.isPremium
                              ? 'Magnific Premium'
                              : 'Magnific Free'}
                          </span>

                        )}

                      </div>

                      <p
                        className="text-xs font-bold text-[#F5F5F5] truncate mt-0.5"
                        title={
                          resource.filename
                        }
                      >
                        {resource.filename}
                      </p>

                    </div>

                  </div>

                  {resource.resourceId && (
                    <div className="flex items-center justify-between text-[11px] px-2 py-1 bg-[#141414] rounded border border-[#1f1f1f]">

                      <span className="text-[#777777]">
                        ID Oficial da Plataforma:
                      </span>

                      <span className="font-mono text-amber-400 font-bold">
                        #{resource.resourceId}
                      </span>

                    </div>
                  )}

                  {resource.cdnDetails && (
                    <div className="p-2 rounded bg-[#101016] border border-[#2d2d3d] flex flex-col gap-1.5 text-[11px]">

                      <div className="flex items-center justify-between border-b border-[#222230] pb-1">

                        <span className="text-[#A855F7] font-bold uppercase tracking-wider text-[10px]">
                          ⚡ Link Direto CDN Oficial
                        </span>

                        <span
                          className="text-[10px] text-[#888888] font-mono truncate max-w-[170px]"
                          title={
                            resource.cdnDetails.cdnHost
                          }
                        >
                          {
                            resource
                              .cdnDetails
                              .cdnHost
                          }
                        </span>

                      </div>

                      <div className="grid grid-cols-3 gap-1 text-[10px] text-[#CCCCCC]">

                        <div>
                          <span className="text-[#666666] block">
                            Autor:
                          </span>

                          <span className="font-mono">
                            #
                            {resource.cdnDetails
                              .authorId ||
                              '795323'}
                          </span>
                        </div>

                        <div>
                          <span className="text-[#666666] block">
                            Formato:
                          </span>

                          <span className="font-mono">
                            Cód.{' '}
                            {resource.cdnDetails
                              .formatCode ||
                              '2'}{' '}
                            (PSD)
                          </span>
                        </div>

                        <div>
                          <span className="text-[#666666] block">
                            Cluster:
                          </span>

                          <span className="font-mono">
                            #
                            {resource.cdnDetails
                              .clusterId ||
                              '1323'}
                          </span>
                        </div>

                      </div>

                      {resource.cdnDetails
                        .tokenExpiresAt && (

                        <div className="pt-1 border-t border-[#222230]">

                          {resource.cdnDetails
                            .isExpired ? (

                            <p className="text-[10px] text-amber-400/90 leading-tight">
                              ⚠️{' '}
                              <strong>
                                Token expirado no CDN
                              </strong>{' '}
                              em{' '}
                              {formatDate(
                                resource
                                  .cdnDetails
                                  .tokenExpiresAt *
                                  1000
                              )}
                              . O arquivo oficial requer nova autenticação na plataforma.
                            </p>

                          ) : (

                            <p className="text-[10px] text-emerald-400 font-mono">
                              ✓ Token ativo até{' '}
                              {formatDate(
                                resource
                                  .cdnDetails
                                  .tokenExpiresAt *
                                  1000
                              )}
                            </p>

                          )}

                        </div>

                      )}

                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-[#1f1f1f]">

                    <div>
                      <span className="text-[#777777] text-[10px] block">
                        Formato Oficial:
                      </span>

                      <span className="text-[#E50914] font-bold">
                        {resource.type}{' '}
                        Original
                      </span>
                    </div>

                    <div>
                      <span className="text-[#777777] text-[10px] block">
                        Plataforma:
                      </span>

                      <span className="text-[#F5F5F5] font-medium">
                        {resource.domain}
                      </span>
                    </div>

                  </div>

                  <div className="pt-2 border-t border-[#1f1f1f]">

                    <span className="text-[#777777] text-[10px] block">
                      Status de Disponibilidade:
                    </span>

                    <div className="flex items-center gap-1.5 mt-0.5">

                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          resource.isProtected
                            ? 'bg-[#E50914]'
                            : 'bg-emerald-400'
                        }`}
                      />

                      <span
                        className={`text-xs font-medium ${
                          resource.isProtected
                            ? 'text-[#E50914]'
                            : 'text-emerald-400'
                        }`}
                      >
                        {
                          resource.statusMessage
                        }
                      </span>

                    </div>

                  </div>

                </div>

                {resource.isProtected ? (

                  <div className="p-3.5 rounded-md bg-[#7F080E]/20 border border-[#E50914]/40 text-center flex flex-col gap-2 shadow-lg">

                    <div className="flex items-center justify-center gap-1.5 text-[#E50914] font-bold text-xs">

                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>

                      ARQUIVO PROTEGIDO (PREMIUM OFICIAL)

                    </div>

                    <p className="text-[11px] text-[#A0A0A0] leading-relaxed">

                      Este é um recurso premium oficial do{' '}
                      <strong>
                        Magnific / Freepik
                      </strong>
                      . O download requer uma sessão autenticada e autorização ativa da plataforma.

                    </p>

                    <div className="flex flex-col gap-1.5 pt-1">

                      <button
                        type="button"
                        onClick={() =>
                          handleOpenInBrowser(
                            resource.pageUrl ||
                              resource.url
                          )
                        }
                        className="w-full bg-[#E50914] hover:bg-[#c40811] text-[#F5F5F5] text-xs font-bold py-2 rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-[#E50914]/20"
                      >
                        <span>
                          Acessar Recurso no Magnific Oficial ↗
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleCopyDirectUrl(
                            resource.pageUrl ||
                              resource.url
                          )
                        }
                        className="w-full bg-[#141414] hover:bg-[#1f1f1f] border border-[#242424] text-[#F5F5F5] text-[11px] font-semibold py-1.5 rounded transition-colors text-center cursor-pointer"
                      >
                        {copied
                          ? '✓ Link Copiado!'
                          : 'Copiar Link Oficial'}
                      </button>

                    </div>

                    <button
                      type="button"
                      onClick={
                        handleReset
                      }
                      className="mt-1 text-xs text-[#777777] hover:text-[#F5F5F5] transition-colors cursor-pointer"
                    >
                      Processar outro link
                    </button>

                  </div>

                ) : (

                  <div className="flex flex-col gap-2">

                    <button
                      type="button"
                      onClick={() =>
                        triggerDownload(
                          resource
                        )
                      }
                      className="w-full bg-[#E50914] hover:bg-[#c40811] active:bg-[#7F080E] text-[#F5F5F5] text-xs font-bold py-2.5 rounded-md tracking-wider uppercase transition-all duration-150 cursor-pointer shadow-md shadow-[#E50914]/30 flex items-center justify-center gap-2"
                    >

                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>

                      BAIXAR ARQUIVO OFICIAL

                    </button>

                    <div className="grid grid-cols-2 gap-2 pt-0.5">

                      <button
                        type="button"
                        onClick={() =>
                          handleCopyDirectUrl(
                            resource.url
                          )
                        }
                        className="bg-[#141414] hover:bg-[#1f1f1f] border border-[#242424] text-[#F5F5F5] text-[11px] font-semibold py-1.5 rounded transition-colors text-center cursor-pointer"
                        title="Copiar URL direta de download"
                      >
                        {copied
                          ? '✓ Link Copiado!'
                          : 'Copiar Link'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleOpenInBrowser(
                            resource.pageUrl ||
                              resource.url
                          )
                        }
                        className="bg-[#141414] hover:bg-[#1f1f1f] border border-[#242424] text-[#F5F5F5] text-[11px] font-semibold py-1.5 rounded transition-colors text-center cursor-pointer"
                        title="Abrir no Chrome"
                      >
                        Abrir no Chrome ↗
                      </button>

                    </div>

                    <button
                      type="button"
                      onClick={
                        handleReset
                      }
                      className="text-center text-[11px] text-[#777777] hover:text-[#F5F5F5] transition-colors pt-1 cursor-pointer"
                    >
                      Cancelar / Outro Link
                    </button>

                  </div>

                )}

              </div>
            )}

            {/* DOWNLOAD EM ANDAMENTO */}
            {(appState ===
              'preparing' ||
              appState ===
                'downloading') && (

              <div className="p-4 rounded-md bg-[#0D0D0D] border border-[#242424] flex flex-col gap-3">

                <div className="flex items-center justify-between text-xs">

                  <span className="font-bold tracking-wider text-[#F5F5F5] uppercase">
                    BAIXANDO
                  </span>

                  <span className="text-[#E50914] font-bold font-mono">
                    {progress?.percent ||
                      0}
                    %
                  </span>

                </div>

                <div className="w-full bg-[#171717] h-2 rounded-full overflow-hidden border border-[#242424]">

                  <div
                    className="bg-[#E50914] h-full rounded-full transition-all duration-200 ease-out"
                    style={{
                      width: `${
                        progress?.percent ||
                        0
                      }%`,
                    }}
                  />

                </div>

                <div className="flex items-center justify-between text-[11px] text-[#777777] font-mono">

                  <span>
                    {formatBytes(
                      progress?.receivedBytes ||
                        0
                    )}{' '}
                    /{' '}
                    {formatBytes(
                      progress?.totalBytes ||
                        resource?.size ||
                        0
                    )}
                  </span>

                  <span>
                    {formatSpeed(
                      progress?.speed ||
                        0
                    )}
                  </span>

                </div>

              </div>
            )}

            {/* CONCLUÍDO */}
            {appState ===
              'completed' && (

              <div className="p-4 rounded-md bg-[#0D0D0D] border border-emerald-500/40 text-center flex flex-col gap-3">

                <div className="w-9 h-9 rounded-full bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center font-bold text-sm">
                  ✓
                </div>

                <div>

                  <h3 className="text-xs font-bold tracking-wider text-[#F5F5F5] uppercase">
                    DOWNLOAD CONCLUÍDO
                  </h3>

                  <p className="text-[11px] text-[#777777] mt-1 truncate">
                    {resource?.filename}{' '}
                    salvo na pasta de downloads.
                  </p>

                </div>

                <button
                  type="button"
                  onClick={
                    handleReset
                  }
                  className="mt-2 w-full bg-[#1a1a1a] hover:bg-[#242424] border border-[#242424] text-[#F5F5F5] text-xs font-semibold py-2 rounded-md transition-colors"
                >
                  Baixar outro arquivo
                </button>

              </div>
            )}

          </div>
        )}

        {/* HISTÓRICO */}
        {activeTab ===
          'history' && (

          <div className="flex flex-col gap-3 h-full">

            <div className="flex items-center justify-between text-xs text-[#777777] pb-1 border-b border-[#1f1f1f]">

              <span className="uppercase tracking-wider font-semibold">
                Downloads Locais
              </span>

              <div className="flex items-center gap-2">

                {history.length >
                  0 && (
                  <>
                    <button
                      type="button"
                      onClick={
                        handleExportHistory
                      }
                      className="hover:text-[#F5F5F5] transition-colors"
                      title="Exportar para JSON"
                    >
                      Exportar
                    </button>

                    <span>
                      •
                    </span>

                    <button
                      type="button"
                      onClick={
                        handleClearHistory
                      }
                      className="hover:text-[#E50914] transition-colors"
                    >
                      Limpar
                    </button>
                  </>
                )}

              </div>

            </div>

            {history.length >
              3 && (

              <input
                type="text"
                value={
                  historySearch
                }
                onChange={(e) =>
                  setHistorySearch(
                    e.target.value
                  )
                }
                placeholder="Buscar no histórico..."
                className="w-full bg-[#0D0D0D] border border-[#242424] focus:border-[#E50914] text-[11px] text-[#F5F5F5] px-2.5 py-1.5 rounded outline-none placeholder-[#444444]"
              />

            )}

            {filteredHistory.length ===
            0 ? (

              <div className="py-14 text-center text-xs text-[#777777]">

                {history.length ===
                0
                  ? 'Nenhum download registrado ainda.'
                  : 'Nenhum resultado para a busca.'}

              </div>

            ) : (

              <div className="flex flex-col gap-2 max-h-[310px] overflow-y-auto pr-1">

                {filteredHistory.map(
                  (item) => (

                    <div
                      key={
                        item.id
                      }
                      className="p-2.5 rounded-md bg-[#0D0D0D] border border-[#242424] flex items-center justify-between text-xs hover:border-[#383838] transition-colors"
                    >

                      <div className="truncate pr-2">

                        <p className="font-medium text-[#F5F5F5] truncate">
                          {
                            item.filename
                          }
                        </p>

                        <p className="text-[10px] text-[#777777] mt-0.5">
                          {formatBytes(
                            item.size
                          )}{' '}
                          •{' '}
                          {formatDate(
                            item.date
                          )}
                        </p>

                      </div>

                      <div className="flex items-center gap-2 shrink-0">

                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded uppercase font-semibold ${
                            item.status ===
                            'completed'
                              ? 'text-emerald-400 bg-emerald-950/40'
                              : 'text-[#E50914] bg-[#7F080E]/30'
                          }`}
                        >
                          {item.status ===
                          'completed'
                            ? 'OK'
                            : 'Falha'}
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveHistoryItem(
                              item.id
                            )
                          }
                          className="text-[#777777] hover:text-[#F5F5F5] transition-colors px-1"
                          title="Remover"
                        >
                          ×
                        </button>

                      </div>

                    </div>

                  )
                )}

              </div>

            )}

          </div>
        )}

        {/* CONFIGURAÇÕES */}
        {activeTab ===
          'settings' && (

          <div className="flex flex-col gap-3.5 max-h-[330px] overflow-y-auto pr-1 text-xs">

            <div className="flex items-center justify-between pb-1 border-b border-[#1f1f1f]">

              <span className="uppercase tracking-wider font-semibold text-[#777777] text-[11px]">
                Preferências de Download
              </span>

              <button
                type="button"
                onClick={
                  handleResetSettings
                }
                className="text-[10px] text-[#777777] hover:text-[#E50914] transition-colors"
              >
                Padrão
              </button>

            </div>

            {/* CONFLITO */}
            <div className="p-3 rounded-md bg-[#0D0D0D] border border-[#242424] flex flex-col gap-2">

              <label className="text-[11px] font-semibold text-[#F5F5F5]">
                Se o arquivo já existir:
              </label>

              <select
                value={
                  settings.conflictAction
                }
                onChange={(e) =>
                  updateSetting(
                    'conflictAction',
                    e.target
                      .value as
                      | 'uniquify'
                      | 'overwrite'
                      | 'prompt'
                  )
                }
                className="w-full bg-[#141414] border border-[#2b2b2b] text-xs text-[#F5F5F5] p-2 rounded outline-none focus:border-[#E50914]"
              >

                <option value="uniquify">
                  Renomear automaticamente (arquivo (1).zip)
                </option>

                <option value="overwrite">
                  Substituir arquivo existente
                </option>

                <option value="prompt">
                  Perguntar onde salvar sempre
                </option>

              </select>

            </div>

            {/* AUTO DOWNLOAD */}
            <div className="p-3 rounded-md bg-[#0D0D0D] border border-[#242424] flex items-center justify-between">

              <div>

                <p className="text-[11px] font-semibold text-[#F5F5F5]">
                  Download Automático
                </p>

                <p className="text-[10px] text-[#777777] mt-0.5">
                  Baixar imediatamente após validar o link
                </p>

              </div>

              <button
                type="button"
                onClick={() =>
                  updateSetting(
                    'autoDownload',
                    !settings.autoDownload
                  )
                }
                className={`w-10 h-5 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                  settings.autoDownload
                    ? 'bg-[#E50914]'
                    : 'bg-[#242424]'
                }`}
              >

                <div
                  className={`w-4 h-4 rounded-full bg-[#F5F5F5] shadow-md transform transition-transform duration-200 ease-in-out ${
                    settings.autoDownload
                      ? 'translate-x-5'
                      : 'translate-x-0'
                  }`}
                />

              </button>

            </div>

            {/* SUBPASTA */}
            <div className="p-3 rounded-md bg-[#0D0D0D] border border-[#242424] flex flex-col gap-1.5">

              <label className="text-[11px] font-semibold text-[#F5F5F5]">
                Subpasta em Downloads:
              </label>

              <input
                type="text"
                value={
                  settings.subfolder
                }
                onChange={(e) =>
                  updateSetting(
                    'subfolder',
                    e.target.value
                  )
                }
                placeholder="7MGFC"
                className="w-full bg-[#141414] border border-[#2b2b2b] text-xs text-[#F5F5F5] p-2 rounded outline-none focus:border-[#E50914]"
              />

              <p className="text-[9px] text-[#777777]">
                Salva em:{' '}
                <span className="font-mono text-[#F5F5F5]">
                  Downloads/
                  {settings.subfolder ||
                    ''}
                </span>
              </p>

            </div>

            {/* LIMITE HISTÓRICO */}
            <div className="p-3 rounded-md bg-[#0D0D0D] border border-[#242424] flex items-center justify-between">

              <div>

                <p className="text-[11px] font-semibold text-[#F5F5F5]">
                  Limite do Histórico
                </p>

                <p className="text-[10px] text-[#777777] mt-0.5">
                  Registros salvos localmente
                </p>

              </div>

              <select
                value={
                  settings.maxHistoryItems
                }
                onChange={(e) =>
                  updateSetting(
                    'maxHistoryItems',
                    Number(
                      e.target.value
                    )
                  )
                }
                className="bg-[#141414] border border-[#2b2b2b] text-xs text-[#F5F5F5] px-2 py-1 rounded outline-none focus:border-[#E50914]"
              >

                <option value={15}>
                  15 itens
                </option>

                <option value={30}>
                  30 itens
                </option>

                <option value={50}>
                  50 itens
                </option>

                <option value={100}>
                  100 itens
                </option>

              </select>

            </div>

            {/* API KEY */}
            <div className="p-3 rounded-md bg-[#0D0D0D] border border-[#242424] flex flex-col gap-1.5">

              <div className="flex items-center justify-between">

                <label className="text-[11px] font-semibold text-[#F5F5F5]">
                  API Key Magnific / Freepik (Opcional):
                </label>

                <span className="text-[9px] text-amber-400 font-bold px-1.5 py-0.2 rounded bg-amber-400/10 border border-amber-400/20">
                  PRO
                </span>

              </div>

              <input
                type="password"
                value={
                  settings.magnificApiKey ||
                  ''
                }
                onChange={(e) =>
                  updateSetting(
                    'magnificApiKey',
                    e.target.value
                  )
                }
                placeholder="Insira sua chave de API para chamadas diretas"
                className="w-full bg-[#141414] border border-[#2b2b2b] text-xs text-[#F5F5F5] p-2 rounded outline-none focus:border-[#E50914]"
              />

              <p className="text-[9px] text-[#777777]">
                Se informada, será usada para autenticar requisições na API oficial do Magnific.
              </p>

            </div>

          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="px-4 py-2.5 border-t border-[#242424] bg-[#080808] flex items-center justify-between text-[10px] text-[#777777]">

        <span>
          7MGFC Local Core • 100% Client-Side
        </span>

        <span className="font-mono text-[#E50914]">
          v1.0.0
        </span>

      </footer>

    </div>
  );
}