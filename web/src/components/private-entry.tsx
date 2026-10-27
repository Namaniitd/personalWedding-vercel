import styles from "./private-entry.module.css";

type EntryVariant = "welcome" | "unavailable";

const content = {
  welcome: {
    eyebrow: "A private celebration",
    title: "Your invitation has a personal link.",
    lead: "Open the invitation link sent by the family or coordination team to view the event details and let us know whether you can attend.",
    hindiTitle: "आपका निमंत्रण एक निजी लिंक से खुलेगा।",
    hindiLead: "समारोहों की जानकारी देखने और अपना जवाब देने के लिए परिवार या आयोजन टीम से मिले संदेश का निमंत्रण लिंक खोलें।"
  },
  unavailable: {
    eyebrow: "Invitation help",
    title: "This link could not be opened.",
    lead: "This link may have expired or been replaced. Please ask the person who sent your invitation or the coordination team for a new private link.",
    hindiTitle: "यह निमंत्रण लिंक नहीं खुल सका।",
    hindiLead: "संभव है यह लिंक अब मान्य न हो या इसकी जगह नया लिंक जारी हुआ हो। कृपया निमंत्रण भेजने वाले व्यक्ति या आयोजन टीम से नया निजी लिंक माँगें।"
  }
} as const;

export function PrivateEntry({ variant = "welcome" }: { variant?: EntryVariant }) {
  const page = content[variant];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brandMark} aria-hidden="true">✦</span>
        <span>Wedding invitation<small lang="hi">शुभ विवाह</small></span>
      </header>
      <div className={styles.content}>
        <section className={styles.message} aria-labelledby="entry-title">
          <p className={styles.eyebrow}>{page.eyebrow}</p>
          <h1 id="entry-title">{page.title}</h1>
          <p className={styles.lead}>{page.lead}</p>
          <div className={styles.hindi} lang="hi">
            <h2>{page.hindiTitle}</h2>
            <p>{page.hindiLead}</p>
          </div>
        </section>
        <aside className={styles.steps} aria-label="How to open your invitation">
          <div className={styles.seal} aria-hidden="true"><span>✦</span></div>
          <p className={styles.stepsEyebrow}>Your next steps</p>
          <ol>
            <li><span>01</span><p>Find the invitation message sent to you or your family.</p></li>
            <li><span>02</span><p>Open the link to view the event details, get directions and send your RSVP.</p></li>
            <li><span>03</span><p>If the link is missing or won’t open, ask the sender for help.</p></li>
          </ol>
          <p className={styles.privacy}>Your invitation link is private. Please share it only with family members included in the invitation.</p>
        </aside>
      </div>
      <footer className={styles.footer}><span>Made for a joyful gathering</span><span lang="hi">अतिथि देवो भवः</span></footer>
    </main>
  );
}
