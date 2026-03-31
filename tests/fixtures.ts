// ─── Test Data ───────────────────────────────────────────────────────────────

export const CREDENTIALS = {
  valid: { email: '1144890814@qq.com', password: '66666666' },
  invalidPassword: { email: '1144890814@qq.com', password: 'wrongpass' },
  invalidEmail: { email: 'notexist@example.com', password: '66666666' },
};

// Stripe test cards: https://stripe.com/docs/testing
export const CARDS = {
  /** Standard success card */
  visa_success: {
    number: '4242 4242 4242 4242',
    expiry: '09/29',
    cvc: '424',
    name: 'W',
  },
  /** Card declined */
  visa_declined: {
    number: '4000 0000 0000 0002',
    expiry: '09/29',
    cvc: '424',
    name: 'W',
  },
  /** Insufficient funds */
  insufficient_funds: {
    number: '4000 0000 0000 9995',
    expiry: '09/29',
    cvc: '424',
    name: 'W',
  },
  /** 3DS — authentication required, then succeeds */
  three_d_secure: {
    number: '4000 0025 0000 3155',
    expiry: '09/29',
    cvc: '424',
    name: 'W',
  },
  /** 3DS — authentication required, user fails it → payment fails */
  three_d_secure_fail: {
    number: '4000 0000 0000 0341',
    expiry: '09/29',
    cvc: '424',
    name: 'W',
  },
  /** Expired card */
  expired: {
    number: '4000 0000 0000 0069',
    expiry: '09/29',
    cvc: '424',
    name: 'W',
  },
};
