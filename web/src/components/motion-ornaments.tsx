import styles from "./wedding-experience.module.css";

export function Mandala({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 400 400" fill="none" aria-hidden="true"><circle cx="200" cy="200" r="177" stroke="currentColor" strokeWidth=".7" /><circle cx="200" cy="200" r="157" stroke="currentColor" strokeWidth=".5" /><circle cx="200" cy="200" r="116" stroke="currentColor" strokeWidth="1" /><circle cx="200" cy="200" r="58" stroke="currentColor" strokeWidth=".7" />{Array.from({ length: 12 }, (_, index) => <g key={index} transform={`rotate(${index * 30} 200 200)`}><path d="M200 42Q251 110 200 150Q149 110 200 42Z" stroke="currentColor" strokeWidth=".8" /><path d="M200 72Q222 113 200 142Q178 113 200 72Z" stroke="currentColor" strokeWidth=".5" /><path d="M200 13v21M200 155v-8" stroke="currentColor" /><circle cx="200" cy="29" r="2.5" fill="currentColor" /><path d="m200 170 7 18-7 12-7-12Z" stroke="currentColor" strokeWidth=".7" /></g>)}<circle cx="200" cy="200" r="27" stroke="currentColor" strokeWidth=".8" /><path d="M180 200h40m-20-20v40m-14-34 28 28m0-28-28 28" stroke="currentColor" strokeWidth=".7" /><circle cx="200" cy="200" r="7" fill="currentColor" /></svg>;
}

export function PetalField() {
  return <div className={styles["petal-field"]} aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i className={styles["floating-petal"]} key={index} />)}</div>;
}

export function HeroOrnaments() {
  return <div className={styles["hero-motion-art"]} aria-hidden="true"><Mandala className={styles["hero-mandala"] + " " + styles["mandala-one"]} /><Mandala className={styles["hero-mandala"] + " " + styles["mandala-two"]} /><div className={styles["hero-light"] + " " + styles["light-one"]} /><div className={styles["hero-light"] + " " + styles["light-two"]} /><PetalField /><span className={styles["hero-corner-flourish"] + " " + styles["flourish-left"]}>✧</span><span className={styles["hero-corner-flourish"] + " " + styles["flourish-right"]}>✧</span></div>;
}
