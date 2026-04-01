// ============================================================
// CONFIGURAÇÃO SUPABASE
// Substitui pelos teus valores do Supabase Dashboard:
// Project Settings → API → Project URL e anon/public key
// ============================================================
const SUPABASE_URL  = 'https://bjdergirxpfgbypvyeiy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqZGVyZ2lyeHBmZ2J5cHZ5ZWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjkzNzUsImV4cCI6MjA5MDIwNTM3NX0.cnPy8NWPzpaMHXKW43IXUt2Xg5riGdpszPMl7zra_uU';

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON);

// ============================================================
// AUTENTICAÇÃO
// ============================================================

/** Mostra o ecrã de login e esconde a app principal. */
function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-main').classList.add('hidden');
}

/** Esconde o ecrã de login e mostra a app principal. */
let currentUser = null; // Utilizador atual (global)

function showApp(user) {
    currentUser = user; // Guardar utilizador globalmente
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-main').classList.remove('hidden');

    // Preencher perfil do utilizador
    const nameEl   = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    const placeholderEl = document.getElementById('user-avatar-placeholder');

    if (user) {
        const fullName = user.user_metadata?.full_name || user.email || 'Utilizador';
        const firstName = fullName.split(' ')[0];
        const avatarUrl = user.user_metadata?.avatar_url;

        if (nameEl) {
            nameEl.innerText = firstName;
            nameEl.classList.remove('hidden');
        }

        if (avatarUrl && avatarEl) {
            avatarEl.src = avatarUrl;
            avatarEl.classList.remove('hidden');
            if (placeholderEl) placeholderEl.classList.add('hidden');
        } else if (placeholderEl) {
            placeholderEl.innerText = firstName.charAt(0).toUpperCase();
        }
    }

    // Inicializar o dashboard após login confirmado
    initDashboard();
}

/** Trata o clique no botão de login com Google. */
async function loginWithGoogle() {
    const btn = document.getElementById('btn-google-login');
    const errEl = document.getElementById('login-error');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            A redirecionar...
        `;
    }

    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            // Usar apenas a origem (sem query params/hash) para evitar loops
            // no segundo login causados por parâmetros OAuth residuais no URL
            redirectTo: window.location.origin
        }
    });

    if (error) {
        console.error('Erro de login:', error);
        if (errEl) {
            errEl.innerText = 'Erro ao iniciar sessão: ' + error.message;
            errEl.classList.remove('hidden');
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg class="w-5 h-5" viewBox="0 0 48 48">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                Continuar com Google
            `;
        }
    }
}

/** Termina a sessão do utilizador. */
async function logout() {
    await supabaseClient.auth.signOut();

    // Resetar o flag para que o dashboard seja reiniciado no próximo login
    window._dashboardInitialized = false;

    showLoginScreen();

    // Limpar o perfil
    const nameEl = document.getElementById('user-name');
    const avatarEl = document.getElementById('user-avatar');
    const placeholderEl = document.getElementById('user-avatar-placeholder');
    if (nameEl) nameEl.classList.add('hidden');
    if (avatarEl) avatarEl.classList.add('hidden');
    if (placeholderEl) {
        placeholderEl.classList.remove('hidden');
        placeholderEl.innerText = '?';
    }
}

// ============================================================
// GESTÃO DE SESSÃO
// ============================================================

// 1. Verificação inicial: ao carregar a página, ver se já existe sessão ativa
//    (inclui a sessão recém-criada após redirect OAuth)
supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
        showApp(session.user);
    } else {
        showLoginScreen();
    }
});

// 2. Ouvinte de mudanças de estado (APENAS para eventos explícitos)
//    NÃO reagimos a INITIAL_SESSION porque já tratamos acima com getSession()
//    e o INITIAL_SESSION pode disparar com null a meio do processo PKCE
supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
        showApp(session.user);
    } else if (event === 'SIGNED_OUT') {
        showLoginScreen();
    }
    // TOKEN_REFRESHED, USER_UPDATED, etc. são ignorados
});

// Registar eventos dos botões de login/logout
document.getElementById('btn-google-login')?.addEventListener('click', loginWithGoogle);
document.getElementById('btn-logout')?.addEventListener('click', logout);

// ============================================================
// MODAL: REGISTO DE DISPOSITIVO
// ============================================================

/** Abre o modal de registo de dispositivo. */
function openDeviceModal() {
    document.getElementById('modal-device').classList.remove('hidden');
    const statusEl = document.getElementById('device-status');
    if (statusEl) { statusEl.classList.add('hidden'); statusEl.innerText = ''; }
}

/** Fecha o modal de registo de dispositivo. */
function closeDeviceModal() {
    document.getElementById('modal-device').classList.add('hidden');
}

/** Guarda a associação device_id <-> user no backend. */
async function saveDeviceRegistration() {
    const deviceIdInput = document.getElementById('input-device-id');
    const statusEl = document.getElementById('device-status');
    const btn = document.getElementById('btn-save-device');

    const deviceId = deviceIdInput?.value.trim();
    if (!deviceId) {
        if (statusEl) {
            statusEl.innerText = '❌ Introduz um Device ID válido.';
            statusEl.className = 'text-xs mb-4 text-red-400';
            statusEl.classList.remove('hidden');
        }
        return;
    }

    // Obter o token JWT da sessão atual
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        if (statusEl) {
            statusEl.innerText = '❌ Não estás autenticado.';
            statusEl.className = 'text-xs mb-4 text-red-400';
            statusEl.classList.remove('hidden');
        }
        return;
    }

    if (btn) { btn.disabled = true; btn.innerText = 'A guardar...'; }

    try {
        const res = await fetch('/api/register-device', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ device_id: deviceId })
        });

        if (res.ok) {
            if (statusEl) {
                statusEl.innerText = `✅ Dispositivo "${deviceId}" associado com sucesso!`;
                statusEl.className = 'text-xs mb-4 text-green-400';
                statusEl.classList.remove('hidden');
            }
            setTimeout(closeDeviceModal, 2000);
        } else {
            const err = await res.json();
            if (statusEl) {
                statusEl.innerText = `❌ Erro: ${err.detail || 'Falha ao guardar.'}`;
                statusEl.className = 'text-xs mb-4 text-red-400';
                statusEl.classList.remove('hidden');
            }
        }
    } catch (e) {
        if (statusEl) {
            statusEl.innerText = '❌ Erro de ligação ao servidor.';
            statusEl.className = 'text-xs mb-4 text-red-400';
            statusEl.classList.remove('hidden');
        }
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = 'Guardar Associação'; }
    }
}

document.getElementById('btn-register-device')?.addEventListener('click', openDeviceModal);
document.getElementById('btn-close-device-modal')?.addEventListener('click', closeDeviceModal);
document.getElementById('btn-save-device')?.addEventListener('click', saveDeviceRegistration);

// Fechar modal ao clicar fora
document.getElementById('modal-device')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-device')) closeDeviceModal();
});

// ============================================================
// FUNÇÃO PRINCIPAL DO DASHBOARD (chamada após login)
// ============================================================
function initDashboard() {
    // Verificar se o dashboard já foi iniciado para evitar dupla inicialização
    if (window._dashboardInitialized) return;
    window._dashboardInitialized = true;

const API_BASE = "/api";

// Inicializar o Chart.js
const ctx = document.getElementById('sensorChart').getContext('2d');
const sensorChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Temperatura (°C)',
                data: [],
                borderColor: '#3b82f6', // azul-500
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 0
            },
            {
                label: 'Luminosidade (lx)',
                data: [],
                borderColor: '#eab308', // amarelo-500
                backgroundColor: 'rgba(234, 179, 8, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                yAxisID: 'y1'
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#cbd5e1' } },
            tooltip: { mode: 'index', intersect: false }
        },
        scales: {
            x: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8' }
            },
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#94a3b8' }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: '#94a3b8' }
            }
        },
        interaction: {
            mode: 'nearest',
            axis: 'x',
            intersect: false
        }
    }
});

let lastDataCount = 0;
let lastAlertTimestamp = null;
let lastRefreshTime = null;
let lastDataReceivedTimestamp = 0;
let allDataHistory = [];
let hideAlertsBefore = 0; // Timestamp local a partir do qual mostramos alertas

function updateConnectionStatus(isOnline) {
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');
    const statusPing = document.getElementById('status-ping');
    
    if (!statusText || !statusDot || !statusPing) return;

    if (isOnline) {
        statusText.innerText = "Sistema Online";
        statusText.className = "text-sm font-medium text-slate-300";
        statusDot.className = "relative inline-flex rounded-full h-3 w-3 bg-green-500";
        statusPing.classList.replace('bg-slate-400', 'bg-green-400');
        statusPing.classList.remove('hidden');
    } else {
        statusText.innerText = "Sistema Offline";
        statusText.className = "text-sm font-medium text-slate-500";
        statusDot.className = "relative inline-flex rounded-full h-3 w-3 bg-slate-500";
        statusPing.classList.replace('bg-green-400', 'bg-slate-400');
        statusPing.classList.add('hidden');
    }
}

async function fetchData() {
    try {
        if (!currentUser) return;

        // Usar Supabase JS diretamente — o RLS filtra automaticamente pelo user_id do utilizador atual
        const { data, error } = await supabaseClient
            .from('security_events')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(100);

        if (error) {
            console.error('Erro Supabase (data):', error.message);
            updateConnectionStatus(false);
            return;
        }

        // Os dados vêm da API por ordem cronológica inversa
        // Precisamos da ordem cronológica normal para o gráfico
        const chronoData = [...data].reverse();
        
        // Atualizar o gráfico
        const labels = chronoData.map(d => new Date(d.timestamp).toLocaleTimeString());
        const temps = chronoData.map(d => d.temperature);
        const lights = chronoData.map(d => d.light_level);
        
        sensorChart.data.labels = labels;
        sensorChart.data.datasets[0].data = temps;
        sensorChart.data.datasets[1].data = lights;
        sensorChart.update();

        // Atualizar os Cartões de Estatísticas com os dados mais recentes
        if (data.length > 0) {
            const latest = data[0]; // Dados mais recentes
            document.getElementById('stat-temp').innerText = latest.temperature.toFixed(1);
            document.getElementById('stat-hum').innerText = latest.humidity.toFixed(1);
            document.getElementById('stat-dist').innerText = latest.distance.toFixed(0);
            
            // Atualização do Cartão de Fogo/Chama
            const flameCard = document.getElementById('card-flame');
            const flameIcon = document.getElementById('icon-flame');
            const statFlame = document.getElementById('stat-flame');
            
            if (latest.flame_detected) {
                statFlame.innerText = "ALERTA FOGO";
                statFlame.className = "text-2xl font-bold text-red-500 animate-pulse";
                flameIcon.className = "bg-red-500/20 p-2 rounded-lg text-red-500";
                flameCard.style.border = "1px solid rgba(239, 68, 68, 0.3)";
            } else {
                statFlame.innerText = "Seguro";
                statFlame.className = "text-2xl font-bold text-green-400";
                flameIcon.className = "bg-green-500/20 p-2 rounded-lg text-green-400";
                flameCard.style.border = "1px solid rgba(255, 255, 255, 0.05)";
            }
            
            // Atualização da cor do Cartão de Distância
            const distCard = document.getElementById('card-dist');
            const distIcon = document.getElementById('icon-dist');
            const statDist = document.getElementById('stat-dist');
            
            if (latest.distance < 50.0) {
                statDist.className = "text-4xl font-bold text-orange-400 animate-pulse";
                distIcon.className = "bg-orange-500/20 p-2 rounded-lg text-orange-400";
                distCard.style.border = "1px solid rgba(249, 115, 22, 0.3)";
            } else {
                statDist.className = "text-4xl font-bold text-white";
                distIcon.className = "bg-green-500/20 p-2 rounded-lg text-green-400";
                distCard.style.border = "1px solid rgba(255, 255, 255, 0.05)";
            }

            // Atualizar a Tabela de Histórico
            let latestTimestamp = data.length > 0 ? data[0].timestamp : null;
            if (data.length !== lastDataCount || latestTimestamp !== lastRefreshTime) {
                lastDataReceivedTimestamp = Date.now();
                allDataHistory = data;
                renderHistoryTable();
                lastDataCount = data.length;
                lastRefreshTime = latestTimestamp;
            } else {
                allDataHistory = data;
            }
            
            // Tenta atualizar a recomendação com os novos dados
            if (typeof updateRecommendation === 'function') {
                updateRecommendation();
            }
        }
    } catch (e) {
        console.error("Erro ao obter dados", e);
    }
}

async function fetchAlerts() {
    try {
        if (!currentUser) return;

        // Usar Supabase JS diretamente — o RLS filtra automaticamente pelo user_id do utilizador atual
        const { data: alerts, error } = await supabaseClient
            .from('security_alerts')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(50);

        if (error) {
            console.error('Erro Supabase (alerts):', error.message);
            return;
        }
        
        const container = document.getElementById('alerts-container');
        const badge = document.getElementById('alert-badge');
        
        // Filtrar alertas criados ANTES de carregarmos no botão Limpar
        const visibleAlerts = alerts.filter(a => new Date(a.timestamp).getTime() > hideAlertsBefore);
        
        if (visibleAlerts.length > 0 && document.getElementById('no-alerts-msg')) {
            document.getElementById('no-alerts-msg').style.display = 'none';
        }
        
        badge.innerText = `${visibleAlerts.length} Novo${visibleAlerts.length !== 1 ? 's' : ''}`;
        
        const currentLatestAlert = visibleAlerts.length > 0 ? visibleAlerts[0].timestamp : null;
        const previousAlertsCount = window.lastAlertsCount || 0;
        
        if (currentLatestAlert !== lastAlertTimestamp || visibleAlerts.length !== previousAlertsCount) {
            container.innerHTML = '';
            window.lastAlertsCount = visibleAlerts.length;
            
            if (visibleAlerts.length === 0) {
                container.innerHTML = `
                    <div class="text-center text-slate-500 py-10" id="no-alerts-msg">
                        Nenhuma intrusão detetada. Sistema seguro.
                    </div>
                `;
            } else {
                visibleAlerts.forEach(alert => {
                    const isFire = alert.message.includes("INCENDIO");
                    const iconColor = isFire ? "text-orange-500 bg-orange-500/20" : "text-red-500 bg-red-500/20";
                    const borderClass = isFire ? "border-orange-500/30" : "border-red-500/30";
                    const iconPath = isFire 
                        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"></path>' 
                        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>';

                    const dateObj = new Date(alert.timestamp);
                    const timeStr = dateObj.toLocaleTimeString();

                    const el = document.createElement('div');
                    el.className = `p-4 rounded-xl border ${borderClass} bg-dark/50 flex items-start space-x-3 animation-slideIn`;
                    el.innerHTML = `
                        <div class="p-2 rounded-lg ${iconColor} shrink-0 mt-1">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                ${iconPath}
                            </svg>
                        </div>
                        <div>
                            <div class="text-sm font-semibold text-slate-200">${alert.message}</div>
                            <div class="text-xs text-slate-400 mt-1">${timeStr} • ${alert.device_id}</div>
                        </div>
                    `;
                    container.appendChild(el);
                });
            }
            lastAlertTimestamp = currentLatestAlert;
        }

    } catch (e) {
        console.error("Erro ao obter alertas", e);
    }
}

// Obtenção inicial dos dados
fetchData();
fetchAlerts();

// Definir intervalo para consultar a API a cada 2 segundos
setInterval(() => {
    fetchData();
    fetchAlerts();
    
    // Verificar se se passaram mais de 5 segundos sem novos dados (timeout)
    if (lastDataReceivedTimestamp > 0) {
        const isOnline = (Date.now() - lastDataReceivedTimestamp) < 5000;
        updateConnectionStatus(isOnline);
    } else {
        updateConnectionStatus(false);
    }
}, 2000);

// Lógica de Alternância de Separadores
// NOTA: Executado diretamente (não precisa de DOMContentLoaded pois o initDashboard()
// só é chamado APÓS o login, quando o DOM já está 100% carregado)
const btnDashboard = document.getElementById('tab-btn-dashboard');
const btnHistory   = document.getElementById('tab-btn-history');
const viewDashboard = document.getElementById('view-dashboard');
const viewHistory   = document.getElementById('view-history');

if (btnDashboard) {
    btnDashboard.addEventListener('click', () => {
        viewDashboard.classList.remove('hidden');
        viewHistory.classList.add('hidden');
        btnDashboard.className = "px-5 py-2.5 bg-accent/20 text-accent rounded-xl font-medium transition-colors border border-accent/30 shadow-[0_0_15px_rgba(56,189,248,0.2)]";
        btnHistory.className   = "px-5 py-2.5 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 rounded-xl font-medium transition-colors border border-transparent";
    });
}

if (btnHistory) {
    btnHistory.addEventListener('click', () => {
        viewHistory.classList.remove('hidden');
        viewDashboard.classList.add('hidden');
        btnHistory.className   = "px-5 py-2.5 bg-accent/20 text-accent rounded-xl font-medium transition-colors border border-accent/30 shadow-[0_0_15px_rgba(56,189,248,0.2)]";
        btnDashboard.className = "px-5 py-2.5 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 rounded-xl font-medium transition-colors border border-transparent";
    });
}

// Lógica de Filtros
const btnApplyFilters = document.getElementById('btn-apply-filters');
const btnClearFilters = document.getElementById('btn-clear-filters');

if (btnApplyFilters) {
    btnApplyFilters.addEventListener('click', () => renderHistoryTable());
}

if (btnClearFilters) {
    btnClearFilters.addEventListener('click', () => {
        document.getElementById('filter-date').value = '';
        document.getElementById('filter-time-start').value = '';
        document.getElementById('filter-time-end').value = '';
        document.getElementById('filter-sensor').value = '';
        renderHistoryTable();
    });
}

// Lógica para o botão de limpar alertas
const btnClearAlerts = document.getElementById('btn-clear-alerts');
if (btnClearAlerts) {
    btnClearAlerts.addEventListener('click', () => {
        if (lastAlertTimestamp) {
            hideAlertsBefore = new Date(lastAlertTimestamp).getTime() + 1000;
        } else {
            hideAlertsBefore = Date.now();
        }
        lastAlertTimestamp = null;
        window.lastAlertsCount = 0;

        const container = document.getElementById('alerts-container');
        if (container) {
            container.innerHTML = `
                <div class="text-center text-slate-500 py-10" id="no-alerts-msg">
                    Nenhuma intrusão detetada. Sistema seguro.
                </div>
            `;
        }
        const badge = document.getElementById('alert-badge');
        if (badge) badge.innerText = '0 Novos';
    });
}

function renderHistoryTable() {
    let finalData = allDataHistory;
    
    // Aplicar filtros se os elementos existirem
    const elDate = document.getElementById('filter-date');
    const elTimeStart = document.getElementById('filter-time-start');
    const elTimeEnd = document.getElementById('filter-time-end');
    const elSensor = document.getElementById('filter-sensor');
    
    if (elDate && elTimeStart && elTimeEnd && elSensor) {
        const filterDate = elDate.value;
        const filterTimeStart = elTimeStart.value;
        const filterTimeEnd = elTimeEnd.value;
        const filterSensor = elSensor.value.toLowerCase();
        
        if (filterDate || filterTimeStart || filterTimeEnd || filterSensor) {
            finalData = allDataHistory.filter(row => {
                const d = new Date(row.timestamp);
                
                if (filterDate) {
                    const rowDate = d.toLocaleDateString('en-CA');
                    if (rowDate !== filterDate) return false;
                }
                
                if (filterTimeStart) {
                    const ts = filterTimeStart + ":00";
                    const rowTime = d.toTimeString().split(' ')[0];
                    if (rowTime < ts) return false;
                }
                
                if (filterTimeEnd) {
                    const te = filterTimeEnd + ":59";
                    const rowTime = d.toTimeString().split(' ')[0];
                    if (rowTime > te) return false;
                }
                
                if (filterSensor && row.device_id) {
                    if (!row.device_id.toLowerCase().includes(filterSensor)) return false;
                }
                
                return true;
            });
        }
    }

    const tableBody = document.getElementById('history-table-body');
    const countEl = document.getElementById('history-count');
    
    if (countEl) countEl.innerText = `${finalData.length} registos`;
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    finalData.forEach(row => {
       const tr = document.createElement('tr');
       tr.className = "hover:bg-white/5 transition-colors";
       
       const d = new Date(row.timestamp);
       const timeStr = `${d.toLocaleDateString('pt-PT')} ${d.toLocaleTimeString('pt-PT')}`;
       
       tr.innerHTML = `
           <td class="p-4 border-b border-white/5 text-slate-300 font-medium">${timeStr}</td>
           <td class="p-4 border-b border-white/5 text-slate-400 max-w-[120px] truncate" title="${row.device_id}">${row.device_id}</td>
           <td class="p-4 border-b border-white/5 font-medium ${row.temperature > 50 ? 'text-red-400' : 'text-blue-400'}">${row.temperature.toFixed(1)}°C</td>
           <td class="p-4 border-b border-white/5 text-cyan-400">${row.humidity.toFixed(1)}%</td>
           <td class="p-4 border-b border-white/5 text-yellow-500">${row.light_level.toFixed(0)}lx</td>
           <td class="p-4 border-b border-white/5 ${row.distance < 50 ? 'text-orange-400 font-bold' : 'text-slate-300'}">${row.distance.toFixed(1)}cm</td>
           <td class="p-4 border-b border-white/5">
                ${row.flame_detected 
                    ? '<span class="px-2 py-1 bg-red-500/20 text-red-500 rounded-md text-xs font-bold ring-1 ring-red-500/50 blink">FOGO</span>' 
                    : '<span class="text-green-500/70">Seguro</span>'}
           </td>
       `;
       tableBody.appendChild(tr);
    });
}

// ==========================================
// ASSISTENTE DE CONFORTO (Open-Meteo)
// ==========================================
let currentOutdoorWeather = null;
let userLat = 38.7167; // Coordenadas padrão: Lisboa
let userLon = -9.1333; // Coordenadas padrão: Lisboa

function initWeatherWithLocation() {
    if ("geolocation" in navigator) {
        const recEl = document.getElementById('weather-recommendation');
        if (recEl) recEl.innerText = "A pedir a tua localização ao browser para recomendações exatas...";
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLat = position.coords.latitude;
                userLon = position.coords.longitude;
                console.log("Localização precisa cedida:", userLat, userLon);
                fetchOutdoorWeather();
            },
            (error) => {
                console.warn("Localização negada ou com erro. A voltar para Lisboa.", error);
                fetchOutdoorWeather();
            },
            { timeout: 10000 }
        );
    } else {
        fetchOutdoorWeather();
    }
}

async function fetchOutdoorWeather() {
    try {
        // Open-Meteo é grátis e o 'timezone=auto' descobre o teu fuso horário automaticamente pelas coordenadas dadas!
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${userLat}&longitude=${userLon}&current=temperature_2m,relative_humidity_2m,rain&timezone=auto`;
        
        const res = await fetch(url);
        if (!res.ok) return;
        const weatherData = await res.json();
        
        currentOutdoorWeather = weatherData.current;
        updateRecommendation(); // Atualiza a UI imediatamente
    } catch (e) {
        console.error("Erro ao obter meteorologia:", e);
        const recEl = document.getElementById('weather-recommendation');
        if (recEl) recEl.innerText = "Erro ao ligar ao serviço Meteorológico.";
    }
}

function updateRecommendation() {
    if (!currentOutdoorWeather || allDataHistory.length === 0) return;
    
    // Dados do teu Quarto (os mais recentes vindos do teu ESP32)
    const latestIndoor = allDataHistory[0];
    const inTemp = latestIndoor.temperature;
    
    // Dados da Rua (Temperatura e Chuva)
    const outTemp = currentOutdoorWeather.temperature_2m;
    const outHum = currentOutdoorWeather.relative_humidity_2m;
    const isRaining = currentOutdoorWeather.rain > 0;
    
    // Atualizar os mostradores textuais na interface
    const elOut = document.getElementById('weather-out');
    const elIn = document.getElementById('weather-in');
    if (elOut) elOut.innerText = `${outTemp.toFixed(1)}°C (Hum: ${outHum}%)`;
    if (elIn) elIn.innerText = `${inTemp.toFixed(1)}°C`;
    
    const recEl = document.getElementById('weather-recommendation');
    if (!recEl) return;
    
    // 🧠 O CÉREBRO DA AUTOMAÇÃO & RECOMENDAÇÕES
    if (isRaining) {
        recEl.innerHTML = "🌧️ <strong>Atenção:</strong> Está a chover lá fora. Certifica-te que as janelas do quarto estão fechadas!";
        recEl.className = "text-blue-400 text-sm";
    } else if (inTemp > 25 && outTemp < inTemp - 1) {
        recEl.innerHTML = `🍃 <strong>Dica de Ar Fresco:</strong> O teu quarto está quente (${inTemp.toFixed(1)}°C). Lá fora está mais fresco (${outTemp.toFixed(1)}°C). É ideal abrires a janela para arejar!`;
        recEl.className = "text-green-400 text-sm";
    } else if (inTemp < 19 && outTemp > inTemp + 1) {
        recEl.innerHTML = `☀️ <strong>Dica de Calor:</strong> O quarto está frio. Lá fora está mais ameno (${outTemp.toFixed(1)}°C). Abre a janela e deixa entrar o sol!`;
        recEl.className = "text-orange-400 text-sm";
    } else if (inTemp > 26 && outTemp >= inTemp) {
        recEl.innerHTML = `🔥 <strong>Cuidado:</strong> Está imenso calor tanto dentro como fora. Pondera ligar a ventoinha/AC e fechar os estores!`;
        recEl.className = "text-red-400 text-sm animate-pulse";
    } else if (latestIndoor.humidity > 65) {
        recEl.innerHTML = `💧 <strong>Humidade Elevada:</strong> O quarto está muito húmido (${latestIndoor.humidity.toFixed(1)}%). Recomendamos arejar ou usar desumidificador para prevenir fungos.`;
        recEl.className = "text-cyan-400 text-sm";
    } else {
        recEl.innerHTML = "✨ <strong>Ambiente Perfeito:</strong> O clima no teu quarto está excelente e a temperatura confortável. Trabalha à vontade!";
        recEl.className = "text-slate-300 text-sm";
    }
}

// Inicializar a meteorologia pedindo permissões primeiro e definir um loop de 5 minutos de refresco
initWeatherWithLocation();
setInterval(fetchOutdoorWeather, 300000);

} // fim initDashboard()
