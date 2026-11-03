/** Panel stylesheet; the entry injects it as one <style> node. */

    export const CSS = `
.sc-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.6}
.sc-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 24px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sc-title{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.sc-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-header-actions{display:flex;gap:8px;flex-shrink:1;flex-wrap:wrap;min-width:0;max-width:100%}
.sc-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(230px,290px) minmax(0,1fr)}
.sc-list{min-height:0;overflow:auto;padding:14px 12px 24px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.sc-list-label{margin:10px 6px 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.sc-work{width:100%;text-align:left;display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:10px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;cursor:pointer}
.sc-work:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-work[aria-current="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.sc-work-title{font-weight:600}
.sc-work-meta{color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-detail{min-height:0;overflow:auto;overflow-x:hidden;padding:20px 24px 40px}
.sc-body-detail{grid-template-columns:minmax(0,1fr)}
.sc-back{margin:0 0 6px;padding:0;border:0;background:none;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}
.sc-rename{display:flex;gap:8px;align-items:center;margin:8px 0}
.sc-rename .sc-input{flex:1}
.sc-trash-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;font-size:12px;opacity:.8}
.sc-btn-small{padding:2px 8px;font-size:12px}
.sc-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.sc-state-card{border:1px solid var(--dsw-alias-border-base,#3333);border-radius:8px;padding:10px 12px;margin:8px 0;display:flex;flex-direction:column;gap:8px}
.sc-state-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.sc-state-label{font-weight:600}
.sc-state-hint{opacity:.7;font-size:12px}
.sc-state-actions{display:flex;gap:8px;flex-wrap:wrap}
.sc-detail-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px}
.sc-detail-title{margin:0;font-size:18px;font-weight:600}
.sc-detail-tagline{margin:2px 0 0;color:var(--dsw-alias-label-secondary)}
.sc-badges{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.sc-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.sc-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.sc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
.sc-badge-error{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.sc-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.sc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.sc-btn:disabled{opacity:.5;cursor:default}
.sc-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.sc-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sc-section{margin-top:22px}
.sc-section-title{margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.sc-volume{margin-bottom:14px}
.sc-volume-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
.sc-volume-title{font-weight:600}
.sc-volume-form{display:flex;flex-direction:column;gap:8px;margin:10px 0;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.sc-narrow{width:84px}
.sc-two-col{display:grid;grid-template-columns:minmax(240px,0.9fr) minmax(320px,1.1fr);gap:16px;align-items:start}
.sc-col{min-width:0}
.sc-chapter-actions{display:flex;flex-wrap:wrap;gap:6px;padding:6px 10px 8px 10px}
.sc-projects{padding:4px 2px}
.sc-project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.sc-project{display:flex;flex-direction:column;gap:4px;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}
.sc-project:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-project-title{font-weight:600}
.sc-metrics{margin:10px 0;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.sc-metrics-list{margin:6px 0 0;padding-left:18px;font-size:12px;opacity:.85}
.sc-chapters{display:flex;flex-direction:column;gap:6px}
.sc-chapter{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer}
.sc-chapter:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-chapter[aria-current="true"]{border-color:var(--dsw-alias-brand-primary)}
.sc-chapter-no{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-secondary);min-width:52px}
.sc-chapter-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-tabs{display:flex;gap:6px;margin:12px 0 8px}
.sc-tab{padding:3px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.sc-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-brand-primary)}
.sc-prose{padding:14px 16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);max-height:56vh;overflow:auto}
.sc-prose p{margin:0 0 .7em}
.sc-prose h1,.sc-prose h2,.sc-prose h3{margin:.2em 0 .5em;font-size:1.05em}
.sc-prose ul,.sc-prose ol{margin:0 0 .7em;padding-left:1.3em}
.sc-prose blockquote{margin:0 0 .7em;padding-left:.8em;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.sc-prose hr{border:none;border-top:1px solid var(--dsw-alias-border-l1);margin:1em 0}
.sc-prose pre{margin:0 0 .7em;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow:auto;font-size:11px}
.sc-item{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);margin-bottom:8px}
.sc-item-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.sc-item-name{font-weight:600}
.sc-item-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sc-item-body{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-done{color:var(--dsw-alias-state-success-primary)}
.sc-open{color:var(--dsw-alias-state-warn-primary)}
.sc-notice{margin:0 0 12px;padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid var(--dsw-alias-border-l2)}
.sc-notice-ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.sc-notice-error{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.sc-notice-info{color:var(--dsw-alias-label-secondary)}
.sc-empty{padding:32px 0;color:var(--dsw-alias-label-secondary);max-width:640px}
.sc-muted{color:var(--dsw-alias-label-secondary)}
.sc-field{display:flex;gap:8px;margin-top:12px}
.sc-input{flex:1;min-width:0;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.sc-help{margin-top:28px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-help summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-help ol{margin:8px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-root{position:relative;container-type:inline-size}
.sc-main-tabs{display:flex;gap:4px;margin:14px 0 6px;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);width:fit-content;max-width:100%;overflow:auto}
.sc-main-tab{padding:5px 14px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.sc-main-tab:hover{color:var(--dsw-alias-label-primary)}
.sc-main-tab[aria-selected="true"]{background:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}
.sc-tab-panel[hidden]{display:none}
.sc-page[hidden]{display:none}
.sc-page{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 4px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-bible-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}
.sc-foundation{display:flex;flex-direction:column;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.sc-foundation-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px}
.sc-foundation-head .sc-section-title{margin:0 0 2px}
.sc-foundation-stages{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.sc-stage{display:flex;flex-direction:column;gap:3px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.sc-stage-done{border-color:var(--dsw-alias-brand-primary)}
.sc-stage-mark{font-weight:700;color:var(--dsw-alias-label-secondary)}
.sc-stage-done .sc-stage-mark{color:var(--dsw-alias-brand-primary)}
.sc-stage-label{font-weight:600}
.sc-stage-state{color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-foundation-docs{margin-top:0}
.sc-foundation-doc summary{cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px}
.sc-dashboard{display:flex;flex-direction:column;gap:14px}
.sc-dash-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
.sc-dash-card{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.sc-dash-card strong{font-size:18px}
.sc-dash-section{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.sc-dash-section h3{margin:0}
.sc-word-row{display:grid;grid-template-columns:52px minmax(0,1fr) 70px;align-items:center;gap:8px}
.sc-word-bar{height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.sc-word-bar span{display:block;height:100%;background:var(--dsw-alias-brand-primary)}
.sc-hook-group{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-hook-group-head{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sc-hook{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:7px 0}
.sc-hook-main{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;min-width:0}
.sc-hook-actions{display:flex;gap:6px}
.sc-summary-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-summary-view{margin-top:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.sc-summary-body{max-height:260px;overflow:auto;white-space:pre-wrap;margin:8px 0 0}
.sc-analysis{display:flex;flex-direction:column;gap:10px}
.sc-analysis-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.sc-analysis-block{display:flex;flex-direction:column;gap:5px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.sc-analysis-row{display:flex;justify-content:space-between;gap:8px;font-size:12px}
.sc-rhythm{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-self-check-list{display:flex;flex-direction:column;gap:6px;margin:8px 0 0;padding:0;list-style:none}
.sc-self-check-list li{display:flex;gap:8px;align-items:flex-start}
.sc-self-check-fallback{display:flex;flex-direction:column;gap:10px}
.sc-logs-body{display:flex;flex-direction:column;gap:8px}
.sc-log-list{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.sc-log-row{display:flex;flex-direction:column;gap:3px;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-log-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.sc-log-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.sc-filter-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}
.sc-filter-input{min-width:140px;flex:1}
.sc-search-body{display:flex;flex-direction:column;gap:8px}
.sc-search-form{display:flex;gap:8px;align-items:center}
.sc-search-form .sc-input{flex:1}
.sc-search-groups{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.sc-search-group{display:flex;flex-direction:column;gap:5px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.sc-search-group-head{font-weight:600;font-size:12px;color:var(--dsw-alias-label-secondary)}
.sc-search-hits{display:flex;flex-direction:column;gap:6px}
.sc-search-hit{display:flex;flex-direction:column;gap:3px}
.sc-search-hit-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px}
.sc-search-snippet{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap}
.sc-bible-card{display:flex;flex-direction:column;gap:6px;margin:0}
.sc-bible-card .sc-item-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-bible-card .sc-yaml{max-height:150px;overflow:auto;margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:11px;overscroll-behavior:contain}
.sc-detail{position:relative}
.sc-drawer-mask{position:absolute;inset:0;z-index:20;display:flex;justify-content:flex-end;background:var(--dsw-alias-bg-mask-1)}
.sc-drawer{display:flex;flex-direction:column;gap:10px;width:min(440px,100%);max-width:100%;box-sizing:border-box;height:100%;padding:18px;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-alias-shadow-l2);overflow:auto}
.sc-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sc-drawer-input{flex:1;min-height:280px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sc-drawer-foot{display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;padding-top:10px;background:var(--dsw-alias-bg-base)}
@container (max-width:600px){.sc-two-col{grid-template-columns:minmax(0,1fr)}.sc-bible-grid{grid-template-columns:minmax(0,1fr)}.sc-foundation-stages{grid-template-columns:repeat(2,minmax(0,1fr))}.sc-dash-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.sc-analysis-grid{grid-template-columns:minmax(0,1fr)}.sc-header-actions{flex-wrap:wrap}}.sc-help li{margin:3px 0}
.sc-help code{padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (max-width:760px){.sc-body{grid-template-columns:minmax(0,1fr)}.sc-list{border-right:none;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:34vh}}
`
