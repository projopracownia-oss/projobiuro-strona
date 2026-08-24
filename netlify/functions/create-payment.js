const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { amountZl, description, email, name } = body;

    if (!amountZl || !description || !email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Brak wymaganych danych (kwota, opis lub e-mail).' }),
      };
    }

    const amount = Math.round(parseFloat(amountZl) * 100); // Przelewy24 przyjmuje kwotę w groszach
    const merchantId = parseInt(process.env.P24_MERCHANT_ID, 10);
    const posId = parseInt(process.env.P24_POS_ID, 10);
    const apiKey = process.env.P24_API_KEY;
    const crc = process.env.P24_CRC;

    if (!merchantId || !posId || !apiKey || !crc) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Brak konfiguracji Przelewy24 po stronie serwera (zmienne środowiskowe).' }),
      };
    }

    const sessionId = 'projo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    // Podpis liczony DOKŁADNIE w tej kolejności pól, zgodnie z dokumentacją P24
    const signPayload = { sessionId, merchantId, amount, currency: 'PLN', crc };
    const sign = crypto.createHash('sha384').update(JSON.stringify(signPayload)).digest('hex');

    const siteUrl = process.env.URL || 'https://projobiuro.pl';

    const payload = {
      merchantId,
      posId,
      sessionId,
      amount,
      currency: 'PLN',
      description,
      email,
      client: name || '',
      country: 'PL',
      language: 'pl',
      urlReturn: siteUrl + '/8-dziekujemy.html',
      urlStatus: siteUrl + '/.netlify/functions/payment-status',
      sign,
    };

    const auth = Buffer.from(`${posId}:${apiKey}`).toString('base64');

    const p24res = await fetch('https://secure.przelewy24.pl/api/v1/transaction/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await p24res.json();

    if (!p24res.ok || !data.data || !data.data.token) {
      console.error('P24 register failed:', p24res.status, JSON.stringify(data));
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Przelewy24 odrzuciło rejestrację płatności.', details: data }),
      };
    }

    const paymentUrl = `https://secure.przelewy24.pl/trnRequest/${data.data.token}`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: paymentUrl }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Błąd serwera przy rejestracji płatności.', message: err.message }),
    };
  }
};
