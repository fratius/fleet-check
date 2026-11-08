import { AddressElement, Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Appearance, type Stripe, type StripeElementLocale, type StripeElementsOptionsMode } from '@stripe/stripe-js';
import { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';

import { useColors } from '@/components/ui';
import { lang, t } from '@/lib/i18n';
import type { CardApi, CardFormProps } from './cardform';

/**
 * The card and billing address, in Stripe's own fields (Stripe.js, loaded from js.stripe.com): card numbers go to
 * Stripe only, never to Fratius. Web only; the store apps sell nothing (cardform.tsx).
 *
 * The fields come first and the intent after (Stripe's "deferred intent"): the person fills in everything once, then
 * submit() checks it, the server makes the subscription (billingStart), and confirm() confirms the card for a trial
 * (a SetupIntent) or the first payment (the invoice's PaymentIntent) with what the server sent back.
 */
export const cardFormSupported = true;

const loaded = new Map<string, Promise<Stripe | null>>();
function stripeOf(key: string) {
  let p = loaded.get(key);
  if (!p) { p = loadStripe(key); loaded.set(key, p); p.catch(() => loaded.delete(key)); }
  return p;
}
const LOCALES = new Set<string>(['ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'vi']);

function appearance(c: ReturnType<typeof useColors>): Appearance {
  return {
    theme: c.dark ? 'night' : 'stripe',
    variables: {
      colorPrimary: c.ink, colorBackground: c.paper, colorText: c.ink, colorTextSecondary: c.ink2, colorDanger: c.alert,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', fontSizeBase: '16px', borderRadius: '4px', spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: `2px solid ${c.rule}`, boxShadow: 'none' },
      '.Input:focus': { border: `2px solid ${c.ink}`, boxShadow: 'none' },
      '.Input--invalid': { border: `2px solid ${c.alert}`, boxShadow: 'none' },
      '.Label': { fontWeight: '500', color: c.ink2 },
      '.Tab': { border: `2px solid ${c.rule}`, boxShadow: 'none' },
      '.Tab--selected': { border: `2px solid ${c.ink}`, boxShadow: 'none' },
    },
  };
}
const elementsMode = (kind: CardFormProps['kind']) => (kind === 'setup' ? 'setup' as const : 'subscription' as const);
const message = (e: { message?: string } | undefined) => e?.message || t('The card couldn\'t be checked. Try again or use another card.');

export function CardForm({ publishableKey, kind, amount, company, onApi }: CardFormProps) {
  const c = useColors();
  const l = lang();
  // Made once; later changes go through elements.update (below), so what was typed stays.
  // Cards only (product owner, 2026-11-05), as the subscription's intents accept.
  const options = useMemo((): StripeElementsOptionsMode => {
    const common = { currency: 'eur', allowedPaymentMethodTypes: ['card'], locale: (LOCALES.has(l) ? l : 'auto') as StripeElementLocale, appearance: appearance(c) };
    return kind === 'payment' ? { ...common, mode: 'subscription', amount: Math.max(50, amount) } : { ...common, mode: 'setup' };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Elements stripe={stripeOf(publishableKey)} options={options}>
      <Fields kind={kind} amount={amount} company={company} onApi={onApi} />
    </Elements>
  );
}

function Fields({ kind, amount, company, onApi }: Omit<CardFormProps, 'publishableKey'>) {
  const stripe = useStripe();
  const elements = useElements();
  const c = useColors();
  const shown = useRef({ kind, amount });
  useEffect(() => {
    if (!elements) return;
    shown.current = { kind, amount };
    elements.update({ mode: elementsMode(kind), ...(kind === 'payment' ? { amount: Math.max(50, amount) } : {}), appearance: appearance(c) });
  }, [elements, kind, amount, c.dark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!stripe || !elements) { onApi(null); return; }
    const api: CardApi = {
      async submit() {
        const r = await elements.submit();
        if (r.error) return { error: message(r.error) };
        const a = elements.getElement('address');
        const v = a ? await a.getValue() : null;
        if (!v?.complete) return { error: t('Enter the company\'s billing address.') };
        const ad = v.value.address;
        return { address: { name: v.value.name, address: { line1: ad.line1, line2: ad.line2 || '', city: ad.city, postal_code: ad.postal_code, state: ad.state || '', country: ad.country } } };
      },
      async confirm(k, clientSecret, amt) {
        // The server decides (a trial, or a payment now); if the form expected the other, it follows and checks again.
        if (k !== shown.current.kind || (k === 'payment' && amt !== shown.current.amount)) {
          shown.current = { kind: k, amount: amt };
          await elements.update({ mode: elementsMode(k), ...(k === 'payment' ? { amount: Math.max(50, amt) } : {}) });
          const again = await elements.submit();
          if (again.error) return { error: message(again.error) };
        }
        const confirmParams = { return_url: `${window.location.origin}/start` };
        if (k === 'setup') {
          const r = await stripe.confirmSetup({ elements, clientSecret, confirmParams, redirect: 'if_required' });
          return r.error ? { error: message(r.error) } : { setupIntent: r.setupIntent?.id || null };
        }
        const r = await stripe.confirmPayment({ elements, clientSecret, confirmParams, redirect: 'if_required' });
        return r.error ? { error: message(r.error) } : { setupIntent: null };
      },
    };
    onApi(api);
    return () => onApi(null);
  }, [stripe, elements]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 14 }}>
      <AddressElement options={{ mode: 'billing', display: { name: 'organization' }, defaultValues: { name: company || '', address: { country: 'DE' } } }} />
      {/* With the Address Element in the same group, the Payment Element takes the billing address from it. Card fields
          only: wallets open their own sheet when the fields are checked, which can't happen again after the server
          answered (the amount with VAT is known only then). */}
      <PaymentElement options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' } }} />
    </View>
  );
}

/** A payment the bank wants confirmed (an upgrade, 3-D Secure): Stripe shows its own window. */
export async function confirmAction(publishableKey: string, clientSecret: string): Promise<{ error?: string }> {
  const s = await stripeOf(publishableKey);
  if (!s) return { error: t('Couldn\'t load the payment form. Check the connection and try again.') };
  const r = await s.handleNextAction({ clientSecret });
  return r.error ? { error: message(r.error) } : {};
}
