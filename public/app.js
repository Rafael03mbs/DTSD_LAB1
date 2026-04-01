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
        const res = await fetch(`${API_BASE}/data?_=${Date.now()}`);
        if (!res.ok) {
            updateConnectionStatus(false);
            return;
        }
        const data = await res.json();
        
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
        const res = await fetch(`${API_BASE}/alerts?_=${Date.now()}`);
        if (!res.ok) return;
        const alerts = await res.json();
        
        const container = document.getElementById('alerts-container');
        const badge = document.getElementById('alert-badge');
        
        // Filtrar alertas criados ANTES de carregarmos no botão Limpar (se hideAlertsBefore estiver definido)
        const visibleAlerts = alerts.filter(a => new Date(a.timestamp).getTime() > hideAlertsBefore);
        
        if (visibleAlerts.length > 0 && document.getElementById('no-alerts-msg')) {
            document.getElementById('no-alerts-msg').style.display = 'none';
        }
        
        badge.innerText = `${visibleAlerts.length} Novo${visibleAlerts.length !== 1 ? 's' : ''}`;
        
        const currentLatestAlert = visibleAlerts.length > 0 ? visibleAlerts[0].timestamp : null;
        const previousAlertsCount = window.lastAlertsCount || 0;
        
        // Apenas re-renderizar se houver um alerta mais recente do que o gravado ou se mudou de quantidade
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
document.addEventListener('DOMContentLoaded', () => {
    const btnDashboard = document.getElementById('tab-btn-dashboard');
    const btnHistory = document.getElementById('tab-btn-history');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewHistory = document.getElementById('view-history');

    btnDashboard.addEventListener('click', () => {
        viewDashboard.classList.remove('hidden');
        viewHistory.classList.add('hidden');
        
        btnDashboard.className = "px-5 py-2.5 bg-accent/20 text-accent rounded-xl font-medium transition-colors border border-accent/30 shadow-[0_0_15px_rgba(56,189,248,0.2)]";
        btnHistory.className = "px-5 py-2.5 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 rounded-xl font-medium transition-colors border border-transparent";
    });

    btnHistory.addEventListener('click', () => {
        viewHistory.classList.remove('hidden');
        viewDashboard.classList.add('hidden');
        
        btnHistory.className = "px-5 py-2.5 bg-accent/20 text-accent rounded-xl font-medium transition-colors border border-accent/30 shadow-[0_0_15px_rgba(56,189,248,0.2)]";
        btnDashboard.className = "px-5 py-2.5 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10 rounded-xl font-medium transition-colors border border-transparent";
    });

    // Lógica de Filtros
    const btnApplyFilters = document.getElementById('btn-apply-filters');
    const btnClearFilters = document.getElementById('btn-clear-filters');
    
    if (btnApplyFilters) {
        btnApplyFilters.addEventListener('click', () => {
            renderHistoryTable();
        });
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

    // Lógica para o botão de limpar alertas (LIMPEZA LOCAL/FRONTEND)
    const btnClearAlerts = document.getElementById('btn-clear-alerts');
    if (btnClearAlerts) {
        btnClearAlerts.addEventListener('click', () => {
            // Apenas atualiza o marcador na UI para esconder tudo a partir desta data, não apaga da BD
            if (lastAlertTimestamp) {
                hideAlertsBefore = new Date(lastAlertTimestamp).getTime() + 1000;
            } else {
                hideAlertsBefore = Date.now();
            }
            
            lastAlertTimestamp = null;
            window.lastAlertsCount = 0;
            
            // Limpar a interface imediatamente para evitar esperas!
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
});

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

async function fetchOutdoorWeather() {
    try {
        // Coordenadas padrão: Lisboa (Podes mudar depois para onde vives)
        const lat = 38.7167;
        const lon = -9.1333;
        
        // Open-Meteo é grátis, hiper-rápido e não requer API key!
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,rain&timezone=Europe%2FLisbon`;
        
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

// Inicializar a meteorologia e definir um loop de 5 minutos
// (Mudar meteorologia a cada 2s não faz sentido, a cada 5m é o ideal para a API)
fetchOutdoorWeather();
setInterval(fetchOutdoorWeather, 300000);
