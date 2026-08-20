export const DEFAULT_CATEGORIES = ["Mercado","Alimentação","Combustível","Compras","Transporte","Moradia","Saúde","Lazer","Educação","Serviços","Salário","Outros"];
export function uid(){return crypto.randomUUID?.()||`tx-${Date.now()}-${Math.random().toString(16).slice(2)}`}
export function parseLooseNumber(input){let raw=String(input??"").trim().replace(/[^\d,.-]/g,"");raw=raw.replace(/^-/ ,"");if(!raw)return 0;const hasComma=raw.includes(","),hasDot=raw.includes(".");if(hasComma&&hasDot){if(raw.lastIndexOf(",")>raw.lastIndexOf("."))return Number(raw.replace(/\./g,"").replace(",","."));return Number(raw.replace(/,/g,""))}if(hasComma){const parts=raw.split(",");return parts.length===2&&parts[1].length===2?Number(raw.replace(",",".")):Number(raw.replace(/,/g,""))}if(hasDot){const parts=raw.split(".");return parts.length===2&&parts[1].length===2?Number(raw):Number(raw.replace(/\./g,""))}return Number(raw)}
export function formatMoney(value,currency){return new Intl.NumberFormat(currency==="BRL"?"pt-BR":"es-PY",{style:"currency",currency,minimumFractionDigits:currency==="PYG"?0:2,maximumFractionDigits:currency==="PYG"?0:2}).format(Number(value)||0)}
export function formatDate(date){if(!date)return"";const[y,m,d]=date.split("-");return`${d}/${m}/${y}`}
export function escapeHtml(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
export function toBaseCurrency(amount,currency,baseCurrency,brlToPyg){if(currency===baseCurrency)return amount;return baseCurrency==="PYG"?amount*brlToPyg:amount/brlToPyg}
export function normalizeToPYG(amount,currency,brlToPyg){return currency==="PYG"?amount:amount*brlToPyg}
export function csvEscape(value){const text=String(value??"");if(/[;"\n]/.test(text))return`"${text.replace(/"/g,'""')}"`;return text}
export function downloadFile(filename,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),600)}
export function startOfMonthISO(date=new Date()){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`}
export function daysInMonth(year,month){return new Date(year,month,0).getDate()}
export function todayISO(){return new Date().toISOString().slice(0,10)}
