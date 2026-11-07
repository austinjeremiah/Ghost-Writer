/**
 * Every string and list rendered by the page, lifted verbatim from the
 * template's markup (typography, curly quotes and all).
 */

export interface NavLink {
  href: string;
  label: string;
  /** The original hides "Roadmap" on small screens. */
  mobileHidden?: boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: '#why', label: 'Why ghost writer' },
  { href: '#integration', label: 'Integration' },
  { href: '#benefits', label: 'Benefits' },
  { href: '#roadmap', label: 'Roadmap', mobileHidden: true },
  { href: '#faq', label: 'FAQ' },
];

export interface Messenger {
  name: string;
  icon: string;
}

export const MESSENGERS: Messenger[] = [
  { name: 'What’sApp', icon: '/icons/whatsapp.svg' },
  { name: 'Email', icon: '/icons/email.svg' },
  { name: 'Telegram', icon: '/icons/telegram.svg' },
  { name: 'Facebook Messanger', icon: '/icons/messanger.svg' },
  { name: 'Discord', icon: '/icons/discord.svg' },
  { name: 'Etc.', icon: '/icons/plus.svg' },
];

export type PurposeIconName =
  | 'problem'
  | 'solution'
  | 'stairs'
  | 'diamonds'
  | 'clover';

export interface PurposeItem {
  icon: PurposeIconName;
  title: string;
  paragraphs: string[];
  /** Renders the messenger list under the copy (the "Solution" card). */
  withMessengers?: boolean;
}

/** `home-3`, first instance — "Purpose of using Ghost Writer". */
export const PURPOSE_ITEMS: PurposeItem[] = [
  {
    icon: 'problem',
    title: 'The problem',
    paragraphs: [
      'When you build the website, the one of the most popular issue is a sending data from contact form to channel that convenient for you or your client.',
      'A lot of time is spent on creating the form, integrating it into the website, and making sure that the information from the form reaches the chosen communication channel quickly and consistently',
      'We have been constantly faced with this problem for several years as web developers. Every time we made a new site, we spent a lot of time to ensure that the information from the form was quickly sent to a convenient communication channel, and not just to email',
    ],
  },
  {
    icon: 'solution',
    title: 'Solution',
    paragraphs: [
      'Therefore, we have created a web service that allows you to connect your contact form to the chosen messenger or email in a few clicks, without the need to write dozens of lines of code, in a matter of minutes',
      'Thus, when a user fills out the contact form on the site, you instantly receive this information in:',
    ],
    withMessengers: true,
  },
];

/** `home-3`, second instance — "Problems that we solve". */
export const PROBLEM_ITEMS: PurposeItem[] = [
  {
    icon: 'stairs',
    title: 'Website conversion increases',
    paragraphs: [
      'Data from the form arrives instantly to selected messengers, so you can efficiently process requests from your customers. The speed of order processing affects the potential client’s decision to work with you',
    ],
  },
  {
    icon: 'diamonds',
    title: 'Less time to set up the form',
    paragraphs: [
      'If you are a developer, you don’t need to create a form backend every time in a new project. This will save time on routine things, which can be spent on more pleasant things',
    ],
  },
  {
    icon: 'clover',
    title: 'You don’t need to know how to program',
    paragraphs: [
      'If you are not a developer, but are building a site yourself on Webflow or another builder, you can easily connect a form and send data to the messenger of your choice.',
    ],
  },
];

export interface IntegrationStep {
  step: string;
  text: string;
}

export const INTEGRATION_STEPS: IntegrationStep[] = [
  { step: 'Step 1', text: 'Create and copy your personal ID link' },
  { step: 'Step 2', text: 'Paste it in your HTML form or in fetch as URL' },
  { step: 'Step 3', text: 'Choose where you want to send data from form' },
  { step: 'Step 4', text: 'Done! The data from your website form is almost here' },
];

export interface Benefit {
  title: string;
  text: string;
}

export const BENEFITS: Benefit[] = [
  {
    title: 'No-code',
    text: "Yeah, it's almost a no-code decision. This service is like a breath of fresh air: ease in use and functional. You don't need to know programming languages to get a request from a potential client in a convenient place",
  },
  {
    title: 'Beautiful and simple',
    text: 'You know, we really made a lot of effort to make such a banal at first glance service a pleasure to use. Fresh design with familiar elements. Isn’t this happiness? Is the Ghost Writer looks simple? You are all right!',
  },
  {
    title: 'One function',
    text: 'You understand, nothing extra. We simply take and send data from website contact forms to messengers of your choice. One service — one function. And it does the job as it should, without much fuss',
  },
  {
    title: 'To anyone',
    text: 'And that, is one of the best features of this product. It is designed both for professional developers who hate routine actions in their work, and for beginners in business who are making their first or second website in their life',
  },
  {
    title: 'Who loves quality',
    text: 'A business needs a contact form to work properly, right? The ghost writer will do its main job well — it will send you a messenger message about a new application from the website as soon as someone fills out the form',
  },
  {
    title: 'And that’s all',
    text: 'With practical experience, the developers of this product have only one goal in mind — to make work life a little easier. No, no less functional (this is important). Namely, it is easier, throwing a lifeline from boring tasks',
  },
];

export interface HeadacheItem {
  title: string;
  text: string;
}

export const HEADACHE_ITEMS: HeadacheItem[] = [
  {
    title: 'For developers',
    text: "You don't need to write a backend for the form handler. With a service-side API, you only need to insert a unique ID into your HTML, and Ghost Writer will do the rest",
  },
  {
    title: 'For Site owners',
    text: 'It will be convenient for you to connect the form of your website to Webflow, for example, and send information to several communication channels at once, without programming skills ',
  },
];

export interface RoadmapItem {
  month: string;
  day: string;
  title: string;
}

/** The first milestone is printed statically above the scrolling roadmap. */
export const ROADMAP_CURRENT = {
  description: '{Alpha release}',
  month: 'Dec',
  day: '19',
};

export const ROADMAP_ITEMS: RoadmapItem[] = [
  { month: 'jan', day: '19', title: '{Beta release}' },
  { month: 'march', day: '03', title: '{Hopefully, a release}' },
  { month: 'apr', day: '23', title: '{Add new messengers}' },
];

export interface FaqItem {
  question: string;
  /** Lines are joined with <br /> to match the original markup. */
  answer: string[];
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Is it form builder?',
    answer: [
      'No, this is the web service that provide an API for implementing backend function to HTML form. It just send all data from your website form to convinient messengers or other chanels.',
    ],
  },
  {
    question: 'What I must to do for implementing this to my website form?',
    answer: [
      'Just follow these three steps:',
      '1. Create an copy your personal ID link.',
      '2. Paste it in your HTML form or in fetch as URL.',
      '3. Choose where you want to send data from form.',
      '4. Done! The data from your website form is almost here. ',
    ],
  },
  {
    question: 'Are the instructions different for integration with different messengers?',
    answer: [
      'Yes, there are certain differences in the instructions for each messenger. But we have done everything so that you as a user do not experience any inconvenience:)',
    ],
  },
  {
    question: 'Is Ghost Writer a paid product?',
    answer: [
      'You can use a free account if it is sufficient for your purposes. But if you need more integrations, then for $10 per month you get unlimited access to integrations.',
    ],
  },
];

export interface FooterContact {
  text: string;
  link: string;
}

export const FOOTER_CONTACTS: FooterContact[] = [
  { text: 'hello@emotion-agency.com', link: 'mailto:hello@emotion-agency.com' },
  { text: 'Whatsapp', link: 'https://wa.me/+380970422959' },
  { text: 'Telegram', link: 'https://t.me/rstetsr' },
];

export const FOOTER_LEGAL = {
  copy: '©2022 Ghost Writer',
  terms: {
    label: 'Terms and conditions',
    href: 'https://www.termsandconditionsgenerator.com/live.php?token=KqfzIWBkH418WdHEZEWKRACbvJtGFf0j',
  },
  privacy: {
    label: 'Privacy Policy',
    href: 'https://www.privacypolicygenerator.info/live.php?token=iEz9YG406khJuP5hPg30r2GlroSf2mmH',
  },
  by: { label: 'by emotion', href: 'https://emotion-agency.com/en/' },
};

export const BENEFITS_TICKER_TEXT = 'A few important benefits';
