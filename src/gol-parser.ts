import { load } from "cheerio";

export type ParsedPlayer={teamIndex:number;name:string;champion:string|null;kills:number;deaths:number;assists:number;cs:number|null};
export type ParsedMetric={teamIndex:number;playerName:string|null;metric:string;value:number};
export type ParsedGame={teams:Array<{golId:number;name:string}>;durationSeconds:number|null;players:ParsedPlayer[];metrics:ParsedMetric[];goldDiff15:number|null;finalGoldDiff:number|null;firstBloodTeam:number|null;firstTowerTeam:number|null;dragons:[number,number];barons:[number,number];heralds:[number,number];towers:[number,number]};
const clean=(value:string)=>value.replace(/\s+/g," ").trim();
const side=(name:string)=>name.includes("blue")?0:name.includes("red")?1:null;

/** DOM-based parser: missing fields remain null; it never substitutes made-up values. */
export function parseGolGame(html:string):ParsedGame{
  const $=load(html),teams:Array<{golId:number;name:string}>=[];
  $("a[href*='teams/team-stats/']").each((_,el)=>{const match=/team-stats\/(\d+)/.exec($(el).attr("href")??""),name=clean($(el).text());if(match&&name&&!teams.some(t=>t.golId===Number(match[1])))teams.push({golId:Number(match[1]),name});});
  const players:ParsedPlayer[]=[];
  $("table.playersInfosLine").each((teamIndex,table)=>{$(table).find("a[href*='players/player-stats/']").each((_,anchor)=>{const row=$(anchor).closest("tr"),cells=row.children("td"),kda=/(\d+)\/(\d+)\/(\d+)/.exec(cells.eq(-2).text());if(!kda)return;const champion=clean(row.find("img.champion_icon").first().attr("alt")??"")||null,cs=Number(clean(cells.last().text()));players.push({teamIndex,name:clean($(anchor).text()),champion,kills:Number(kda[1]),deaths:Number(kda[2]),assists:Number(kda[3]),cs:Number.isFinite(cs)?cs:null});});});
  const duration=/<h1>(\d+):(\d+)<\/h1>/.exec(html),gold=/label:\s*'Gold'[\s\S]{0,240}?data:\s*\[([^\]]+)\]/.exec(html)?.[1].split(",").map(Number).filter(Number.isFinite)??[],metrics:ParsedMetric[]=[];
  const dpms=[...html.matchAll(/title="(\d+(?:\.\d+)?) DPM"/g)].map(m=>Number(m[1]));for(const [index,dpm] of dpms.entries()){const player=players[index];if(player)metrics.push({teamIndex:player.teamIndex,playerName:player.name,metric:"damage_per_minute",value:dpm});}
  const vision=/var visionData\s*=\s*\{[\s\S]{0,1800}?data\s*:\s*\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/g;for(const [index,match] of [...html.matchAll(vision)].entries()){const teamIndex=index%2;metrics.push({teamIndex,playerName:null,metric:"wards_destroyed",value:Number(match[1])},{teamIndex,playerName:null,metric:"wards_placed",value:Number(match[2])});}
  const objective=(term:string):[number,number]=>{const out:[number,number]=[0,0];$(".blue_action img, .red_action img").each((_,img)=>{if(($(img).attr("alt")??"").toLowerCase().includes(term)){const value=side($(img).parent().attr("class")??"");if(value!==null)out[value]++;}});return out;};
  const event=(term:string)=>{const image=$("img").filter((_,img)=>($(img).attr("alt")??"").toLowerCase()===term).first();return image.length?side(image.parent().attr("class")??""):null;};
  return{teams:teams.slice(0,2),durationSeconds:duration?Number(duration[1])*60+Number(duration[2]):null,players,metrics,goldDiff15:gold[15]??null,finalGoldDiff:gold.at(-1)??null,firstBloodTeam:event("first blood"),firstTowerTeam:event("first tower"),dragons:objective("drake"),barons:objective("baron"),heralds:objective("herald"),towers:objective("tower")};
}
