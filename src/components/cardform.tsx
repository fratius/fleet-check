/**
 * The card form is web only (cardform.web.tsx): payments are on the web, and the App Store and Google Play apps sell
 * nothing and show no prices (store/README.md). This file is what the phone apps get.
 */
export interface CardApi {
  /** Checks the card and address fields; gives the billing address (the company's name and address). */
  submit(): Promise<{ error: string } | { address: { name: string; address: { line1: string; line2: string; city: string; postal_code: string; state: string; country: string } } }>;
  /** Confirms with Stripe what the server made: the card for a trial (setup), or a payment now. */
  confirm(kind: 'setup' | 'payment', clientSecret: string, amount: number): Promise<{ error: string } | { setupIntent: string | null }>;
}
export interface CardFormProps {
  publishableKey: string;
  /** What the form expects (the server's answer can still change it): a card for a trial, or a payment now. */
  kind: 'setup' | 'payment';
  /** For a payment: the amount in cents (shown by Apple Pay and Google Pay). */
  amount: number;
  /** The company's name, filled in as the billing name. */
  company?: string;
  onApi(api: CardApi | null): void;
}
export const cardFormSupported = false;
export function CardForm(_: CardFormProps) { return null; }
export async function confirmAction(_key: string, _secret: string): Promise<{ error?: string }> { return { error: 'web only' }; }
