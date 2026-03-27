const API_BASE = "/api";

// Initialize Chart.js
const ctx = document.getElementById('sensorChart').getContext('2d');
const sensorChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Temperatura (°C)',
                data: [],
                borderColor: '#3b82f6', // blue-500
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 0
            },
            {
                label: 'Luminosidade (lx)',
                data: [],
                borderColor: '#eab308', // yellow-500
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
let lastAlertCount = 0;

async function fetchData() {
    try {
        const res = await fetch(`${API_BASE}/data`);
        if (!res.ok) return;
        const data = await res.json();
        
        // Data comes in reverse chronological order from API
        // We need chronological for the chart
        const chronoData = [...data].reverse();
        
        // Update Chart
        const labels = chronoData.map(d => new Date(d.timestamp).toLocaleTimeString());
        const temps = chronoData.map(d => d.temperature);
        const lights = chronoData.map(d => d.light_level);
        
        sensorChart.data.labels = labels;
        sensorChart.data.datasets[0].data = temps;
        sensorChart.data.datasets[1].data = lights;
        sensorChart.update();

        // Update Stat Cards with latest data
        if (data.length > 0) {
            const latest = data[0]; // Most recent
            document.getElementById('stat-temp').innerText = latest.temperature.toFixed(1);
            document.getElementById('stat-hum').innerText = latest.humidity.toFixed(1);
            document.getElementById('stat-dist').innerText = latest.distance.toFixed(0);
            
            // Flame Card Update
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
            
            // Distance Card Update color
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

            // Update History Table
            if (data.length !== lastDataCount) {
                const tableBody = document.getElementById('history-table-body');
                document.getElementById('history-count').innerText = `${data.length} registos`;
                tableBody.innerHTML = '';
                
                data.forEach(row => {
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
                lastDataCount = data.length;
            }
        }
    } catch (e) {
        console.error("Erro a fletch dados", e);
    }
}

async function fetchAlerts() {
    try {
        const res = await fetch(`${API_BASE}/alerts`);
        if (!res.ok) return;
        const alerts = await res.json();
        
        const container = document.getElementById('alerts-container');
        const badge = document.getElementById('alert-badge');
        
        if (alerts.length > 0) {
            document.getElementById('no-alerts-msg').style.display = 'none';
        }
        
        badge.innerText = `${alerts.length} Novo${alerts.length !== 1 ? 's' : ''}`;
        
        // Only re-render if count changed
        if (alerts.length !== lastAlertCount) {
            container.innerHTML = '';
            alerts.forEach(alert => {
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
            lastAlertCount = alerts.length;
        }

    } catch (e) {
        console.error("Erro a fetch alertas", e);
    }
}

// Initial fetch
fetchData();
fetchAlerts();

// Set interval to poll backend every 2 seconds
setInterval(() => {
    fetchData();
    fetchAlerts();
}, 2000);

// Tab Switching Logic
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
});
