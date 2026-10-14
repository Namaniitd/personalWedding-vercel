import styles from "./private-entry.module.css";

type EntryVariant = "welcome" | "unavailable";

const content = {
  welcome: {
    eyebrow: "A private celebration",
    title: "Your invitation has a personal link.",
    lead: "Open the message sent by the family or coordination desk to see the celebrations reserved for your household and to reply.",
    hindiTitle: "आपके निमंत्रण का एक निजी लिंक है।",
    hindiLead: "अपने परिवार के समारोह और RSVP देखने के लिए परिवार या समन्वय डेस्क से मिला संदेश खोलें।"
  },
  unavailable: {
    eyebrow: "Invitation help",
    title: "This link could not be opened.",
    lead: "It may have expired or been replaced. Ask the person who sent your invitation or the coordination desk for a new private link.",
    hindiTitle: "यह निमंत्रण लिंक नहीं खुल सका।",
    hindiLead: "संभव है इसकी अवधि समाप्त हो गई हो या नया लिंक जारी हुआ हो। कृपया निमंत्रण भेजने वाले व्यक्ति या समन्वय डेस्क से नया लिंक माँगें।"
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
            <li><span>01</span><p>Find the invitation message sent to your household.</p></li>
            <li><span>02</span><p>Open its link to see your events, venues, directions and RSVP.</p></li>
            <li><span>03</span><p>For a missing or expired link, reply to the sender for help.</p></li>
          </ol>
          <p className={styles.privacy}>Each link is personal to a household. Please keep yours private.</p>
        </aside>
      </div>
      <footer className={styles.footer}><span>Made for a joyful gathering</span><span lang="hi">अतिथि देवो भवः</span></footer>
    </main>
  );
}
