import type { Locale, LocalizedText } from "@/lib/types";

const genericError: LocalizedText = {
  en: "We couldn’t save your reply. Please try again or contact the coordination team.",
  hi: "आपका जवाब दर्ज नहीं हो सका। कृपया दोबारा कोशिश करें या आयोजन टीम से संपर्क करें।"
};

// Keep the API's existing messages as lookup keys so independently deployed
// services retain their contract. Only recognized messages reach the guest UI.
const messageGroups: Array<LocalizedText & { sources: string[] }> = [
  {
    sources: ["Online RSVPs are now closed. Please contact the coordination desk.", "Online RSVPs are now closed.", "Online RSVP is closed."],
    en: "Online RSVPs are now closed. Please contact the coordination team.",
    hi: "अब ऑनलाइन जवाब नहीं भेजा जा सकता। कृपया आयोजन टीम से संपर्क करें।"
  },
  {
    sources: ["Please wait a minute before trying again."],
    en: "Please wait a minute before trying again.",
    hi: "कृपया एक मिनट रुककर फिर कोशिश करें।"
  },
  {
    sources: ["This invitation link is no longer active.", "This invitation is no longer active.", "The invitation is no longer active."],
    en: "This invitation link is no longer active. Please ask the person who sent it for a new link.",
    hi: "यह निमंत्रण लिंक अब मान्य नहीं है। कृपया निमंत्रण भेजने वाले व्यक्ति से नया लिंक माँगें।"
  },
  {
    sources: ["This RSVP changed in another session. Reload its latest response before saving."],
    en: "Your reply has changed in another session. Reload the page to see the latest reply before making changes.",
    hi: "आपका जवाब किसी दूसरे सत्र में बदल गया है। कोई बदलाव करने से पहले पेज दोबारा खोलकर नया जवाब देख लें।"
  },
  {
    sources: ["Invitation required.", "This request was blocked."],
    en: "Please reopen your invitation link and try again.",
    hi: "कृपया अपने निमंत्रण का लिंक दोबारा खोलकर फिर कोशिश करें।"
  },
  {
    sources: ["The RSVP request is too large.", "This request is too large."],
    en: "Please shorten your reply and try again.",
    hi: "कृपया अपना जवाब थोड़ा छोटा करके फिर कोशिश करें।"
  },
  {
    sources: ["Please review the RSVP details and try again."],
    en: "Please check your reply and try again.",
    hi: "कृपया अपने जवाब की जानकारी जाँचकर फिर कोशिश करें।"
  },
  {
    sources: ["Enter a contact number with 7 to 15 digits, including the country code if needed.", "Please review the RSVP details and enter a valid contact number.", "Please enter a contact number with 7 to 15 digits.", "कृपया 7 से 15 अंकों का संपर्क नंबर लिखें।"],
    en: "Please enter a phone number with 7 to 15 digits, including the country code if needed.",
    hi: "कृपया 7 से 15 अंकों का फ़ोन नंबर लिखें। ज़रूरत हो तो देश का कोड भी जोड़ें।"
  },
  {
    sources: ["Enter your contact number.", "Enter a contact number."],
    en: "Please enter your phone number.",
    hi: "कृपया अपना फ़ोन नंबर लिखें।"
  },
  {
    sources: ["Each event can only appear once in an RSVP."],
    en: "One celebration is listed more than once. Please reopen your invitation and try again.",
    hi: "एक समारोह एक से ज़्यादा बार दिख रहा है। कृपया निमंत्रण दोबारा खोलकर फिर कोशिश करें।"
  },
  {
    sources: ["Comfort notes are only collected for attending guests."],
    en: "Please include requests for your visit only if you plan to attend.",
    hi: "कृपया अपनी सुविधा से जुड़ी जानकारी तभी दें जब आप आने की योजना बना रहे हों।"
  },
  {
    sources: ["A message for the couple can only be sent with a declined RSVP."],
    en: "The message box is for guests who are unable to attend.",
    hi: "संदेश का यह विकल्प उन अतिथियों के लिए है जो शामिल नहीं हो पाएँगे।"
  },
  {
    sources: ["Please remove event attendance before submitting this response."],
    en: "Please review your selected celebrations so they match your reply.",
    hi: "कृपया चुने हुए समारोहों को अपने जवाब के अनुसार बदलें।"
  },
  {
    sources: ["This invitation does not include one of the selected events."],
    en: "One of the selected celebrations is not on your invitation. Please reopen your invitation and try again.",
    hi: "चुने हुए समारोहों में से एक आपके निमंत्रण में शामिल नहीं है। कृपया निमंत्रण दोबारा खोलकर फिर कोशिश करें।"
  },
  {
    sources: ["An attendance limit could not be found for this event."],
    en: "We couldn’t confirm the guest limit for this celebration. Please contact the coordination team.",
    hi: "इस समारोह में आने वाले अतिथियों की सीमा की जानकारी नहीं मिल सकी। कृपया आयोजन टीम से संपर्क करें।"
  },
  {
    sources: ["Guest counts can only be added to an event you are attending."],
    en: "Please enter guest numbers only for celebrations you plan to attend.",
    hi: "कृपया अतिथियों की संख्या केवल उन समारोहों के लिए भरें जिनमें आप शामिल होंगे।"
  },
  {
    sources: ["One of the guest counts exceeds this invitation’s limit."],
    en: "The number of guests exceeds your invitation’s limit. Please check the numbers for each celebration.",
    hi: "अतिथियों की संख्या आपके निमंत्रण की सीमा से ज़्यादा है। कृपया हर समारोह के लिए संख्या जाँच लें।"
  },
  {
    sources: ["Please add at least one guest to each selected event."],
    en: "Please add at least one guest for each celebration you plan to attend.",
    hi: "कृपया जिन समारोहों में आप शामिल होंगे, उनमें कम-से-कम एक अतिथि की संख्या भरें।"
  },
  {
    sources: ["Please answer yes or no for every celebration on this invitation."],
    en: "Please choose yes or no for every celebration on your invitation.",
    hi: "कृपया अपने निमंत्रण के हर समारोह के लिए हाँ या नहीं चुनें।"
  },
  {
    sources: ["Please select at least one event your family plans to attend."],
    en: "Please choose at least one celebration your family plans to attend.",
    hi: "कृपया कम-से-कम एक समारोह चुनें जिसमें आपका परिवार शामिल होगा।"
  },
  {
    sources: ["Please answer every invited celebration and review the guest counts against its limits."],
    en: "Please answer each celebration and check that the guest numbers are within your invitation’s limits.",
    hi: "कृपया हर समारोह के लिए जवाब दें और जाँच लें कि अतिथियों की संख्या आपके निमंत्रण की सीमा में है।"
  },
  {
    sources: [
      "We could not save your response. Please contact the coordination desk.",
      "We could not save this RSVP. Please try again.",
      "The invitation service is temporarily unavailable.",
      "The public invitation is temporarily unavailable.",
      "The private application service is unavailable.",
      "This form needs a JSON request.",
      "A JSON request is required.",
      "Method not allowed",
      "Method not allowed."
    ],
    ...genericError
  }
];

const knownMessages = new Map<string, LocalizedText>();
for (const group of messageGroups) {
  for (const message of [...group.sources, group.en, group.hi]) {
    knownMessages.set(message, group);
  }
}

export function rsvpErrorMessage(message: string, locale: Locale): string {
  return (knownMessages.get(message.trim()) ?? genericError)[locale];
}
