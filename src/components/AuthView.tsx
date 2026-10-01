import { useState } from 'react';
import type { FormEvent } from 'react';
import bcrypt from 'bcryptjs';
import { supabaseRequest } from '../utils/supabase';
import type { UserSession } from '../types';

interface AuthViewProps {
  onLoginSuccess: (user: UserSession) => void;
}

export function AuthView({ onLoginSuccess }: AuthViewProps) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Login form
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regKey, setRegKey] = useState('');

  const clearAlerts = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    clearAlerts();
    const username = loginUsername.trim();
    const password = loginPassword;

    if (!username || !password) {
      setErrorMessage('Preencha todos os campos para entrar.');
      return;
    }

    setLoading(true);

    try {
      const users = await supabaseRequest(
        `users?username=eq.${encodeURIComponent(username)}&select=*`
      );

      if (!users || users.length === 0) {
        setErrorMessage('Usuário não encontrado.');
        setLoading(false);
        return;
      }

      const user = users[0];

      if (user.is_active === false) {
        setErrorMessage('Esta conta foi desativada. Contate o administrador.');
        setLoading(false);
        return;
      }

      if (user.expires_at && new Date(user.expires_at) < new Date()) {
        setErrorMessage('Seu período de acesso expirou. Contate o administrador.');
        setLoading(false);
        return;
      }

      // Password comparison (support bcrypt $2a$, $2b$, $2y$)
      let hash = user.password_hash || '';
      if (hash.startsWith('$2y$')) {
        hash = '$2a$' + hash.substring(4);
      }

      const isValid = bcrypt.compareSync(password, hash);
      if (!isValid) {
        setErrorMessage('Senha incorreta. Verifique suas credenciais.');
        setLoading(false);
        return;
      }

      delete user.password_hash;
      localStorage.setItem('7mgfc_user', JSON.stringify(user));

      setSuccessMessage('Login efetuado com sucesso! Entrando...');
      setTimeout(() => {
        onLoginSuccess(user as UserSession);
      }, 600);
    } catch (err: any) {
      console.error('[7MGFC Auth]', err);
      setErrorMessage('Erro de conexão com o banco de dados. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    clearAlerts();
    const username = regUsername.trim();
    const password = regPassword;
    const accessKey = regKey.trim();

    if (!username || !password || !accessKey) {
      setErrorMessage('Preencha todos os campos do formulário.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);

    try {
      // 1. Check access key in Supabase (key_code is standard, key as fallback)
      let keys = await supabaseRequest(
        `access_keys?key_code=eq.${encodeURIComponent(accessKey)}&select=*`
      ).catch(() => null);

      if (!keys || keys.length === 0) {
        keys = await supabaseRequest(
          `access_keys?key=eq.${encodeURIComponent(accessKey)}&select=*`
        ).catch(() => null);
      }

      if (!keys || keys.length === 0) {
        setErrorMessage('Chave de acesso inválida ou não cadastrada.');
        setLoading(false);
        return;
      }

      const keyData = keys[0];
      const isUsed = keyData.used || keyData.is_used;
      if (isUsed) {
        setErrorMessage('Esta chave de acesso já foi utilizada.');
        setLoading(false);
        return;
      }

      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        setErrorMessage('Esta chave de acesso expirou.');
        setLoading(false);
        return;
      }

      // 2. Check if username is taken
      const existing = await supabaseRequest(
        `users?username=eq.${encodeURIComponent(username)}&select=id`
      );
      if (existing && existing.length > 0) {
        setErrorMessage('Este nome de usuário já está em uso.');
        setLoading(false);
        return;
      }

      // 3. Hash password
      const hash = bcrypt.hashSync(password, 10);

      // Expiration calculation
      let expiresAt: string | null = null;
      if (keyData.valid_days) {
        const date = new Date();
        date.setDate(date.getDate() + Number(keyData.valid_days));
        expiresAt = date.toISOString();
      } else if (keyData.duration_hours) {
        const date = new Date();
        date.setTime(date.getTime() + Number(keyData.duration_hours) * 60 * 60 * 1000);
        expiresAt = date.toISOString();
      }

      const newUser = {
        username,
        password_hash: hash,
        daily_limit: keyData.daily_limit || 30,
        expires_at: expiresAt,
        access_key_used: accessKey,
        is_active: true,
        role: 'user',
      };

      await supabaseRequest('users', 'POST', newUser);

      // 4. Mark key as used (schema uses is_used, used_by, used_at, expires_at)
      const updateKeyPayload: Record<string, any> = {
        is_used: true,
        used_by: username,
        used_at: new Date().toISOString(),
      };
      if (expiresAt) {
        updateKeyPayload.expires_at = expiresAt;
      }
      if ('used' in keyData) {
        updateKeyPayload.used = true;
      }
      await supabaseRequest(`access_keys?id=eq.${keyData.id}`, 'PATCH', updateKeyPayload).catch((e) => {
        console.warn('Erro ao atualizar status da chave:', e);
      });

      setSuccessMessage('Conta criada com sucesso! Redirecionando para login...');
      setTimeout(() => {
        setTab('login');
        setLoginUsername(username);
        setLoginPassword('');
        setSuccessMessage('Conta pronta. Digite sua senha para entrar.');
      }, 1200);
    } catch (err: any) {
      console.error('[7MGFC Register]', err);
      setErrorMessage(err.message || 'Erro ao processar criação de conta.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 bg-[#050505] overflow-hidden">
      {/* Background glowing ambient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-[#E50914]/20 blur-[130px] animate-pulse-glow" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-purple-600/15 blur-[140px] animate-pulse-glow" />
      </div>

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none opacity-40 z-0" />

      {/* Auth Card */}
      <div className="relative z-10 w-full max-w-md glass-panel rounded-2xl p-8 sm:p-10 shadow-2xl border border-white/10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#E50914] to-[#7F080E] shadow-lg shadow-[#E50914]/30 border border-[#E50914]/40 mb-4 transform hover:scale-105 transition-transform duration-300">
            <span className="text-2xl font-black text-white tracking-tighter">7M</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center justify-center gap-2">
            7MGFC
            <span className="text-[11px] font-black uppercase px-2 py-0.5 rounded bg-[#E50914]/20 text-[#E50914] border border-[#E50914]/40">
              WEB PRO
            </span>
          </h1>
          <p className="text-xs text-[#90909a] mt-1.5 font-medium">
            Gerenciamento e Download Direto de Recursos Premium
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex bg-[#0D0D12] p-1 rounded-xl border border-white/5 mb-6">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              clearAlerts();
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              tab === 'login'
                ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/30'
                : 'text-[#90909a] hover:text-white'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              clearAlerts();
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              tab === 'register'
                ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/30'
                : 'text-[#90909a] hover:text-white'
            }`}
          >
            Criar Conta (Chave)
          </button>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className="mb-5 p-3 rounded-xl bg-red-950/40 border border-[#E50914]/40 text-[#ff7d84] text-xs flex items-center gap-2.5 animate-fadeIn">
            <span className="shrink-0 text-base">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2.5 animate-fadeIn">
            <span className="shrink-0 text-base">✓</span>
            <span>{successMessage}</span>
          </div>
        )}

        {/* LOGIN FORM */}
        {tab === 'login' ? (
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#a0a0aa] mb-1.5 uppercase tracking-wider">
                Usuário
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Seu nome de usuário"
                required
                className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#a0a0aa] mb-1.5 uppercase tracking-wider">
                Senha
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Sua senha secreta"
                required
                className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full bg-[#E50914] hover:bg-[#ff1f2d] active:bg-[#c40811] text-white font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition-all duration-150 shadow-lg shadow-[#E50914]/25 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Autenticando...</span>
                </>
              ) : (
                <span>Acessar Painel ⚡</span>
              )}
            </button>
          </form>
        ) : (
          /* REGISTER FORM */
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#a0a0aa] mb-1.5 uppercase tracking-wider">
                Nome de Usuário
              </label>
              <input
                type="text"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                placeholder="Escolha um usuário"
                required
                className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#a0a0aa] mb-1.5 uppercase tracking-wider">
                Senha (mínimo 6 caracteres)
              </label>
              <input
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Crie uma senha segura"
                required
                minLength={6}
                className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#a0a0aa] mb-1.5 uppercase tracking-wider flex items-center justify-between">
                <span>Chave de Acesso (VIP)</span>
                <span className="text-[10px] text-amber-400 font-mono">🔑 Obrigatório</span>
              </label>
              <input
                type="text"
                value={regKey}
                onChange={(e) => setRegKey(e.target.value)}
                placeholder="7MGFC-XXXX-XXXX-XXXX-XXXX"
                required
                className="w-full bg-[#111118] border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder-[#555] focus:outline-none focus:border-[#E50914] focus:ring-1 focus:ring-[#E50914] transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full bg-[#E50914] hover:bg-[#ff1f2d] active:bg-[#c40811] text-white font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider transition-all duration-150 shadow-lg shadow-[#E50914]/25 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Validando Chave...</span>
                </>
              ) : (
                <span>Ativar Acesso & Criar Conta</span>
              )}
            </button>
          </form>
        )}

        <div className="mt-8 pt-5 border-t border-white/5 text-center">
          <p className="text-[11px] text-[#60606d]">
            © {new Date().getFullYear()} 7MGFC • Sistema 100% Web Nativo
          </p>
        </div>
      </div>
    </div>
  );
}
