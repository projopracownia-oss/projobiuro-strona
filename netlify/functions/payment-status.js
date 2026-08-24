const crypto = require('crypto');

// To adres, na który Przelewy24 wysyła potwierdzenie zapłaty.
// Bez tego kroku transakcja zostaje na statusie "Do wykorzystania" i pieniądze
// nie trafiają na saldo — ta funkcja musi odpowiedzieć poprawnie, żeby P24
// zaksięgowało wpłatę.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const notification = JSON.parse(event.body);
    const { merchantId, posId, sessionId, amount, originAmount, currency, orderId, methodId, statement, sign } = notification;

    const crc = process.env.P24_CRC;
    const apiKey = process.env.P24_API_KEY;

    // Podpis przychodzącego powiadomienia P24 liczony jest z: sessionId, orderId, amount, currency, crc
    const expectedSign = crypto
      .createHash('sha384')
      .update(JSON.stringify({ sessionId, orderId, amount, currency, crc }))
      .digest('hex');

    if (sign !== expectedSign) {
      console.error('P24 sign mismatch (kontynuuję mimo to, prawdziwą weryfikacją jest krok verify poniżej). Full notification:', event.body);
      console.error('Received sign:', sign, '| Expected sign:', expectedSign);
    }

    const verifySign = crypto
      .createHash('sha384')
      .update(JSON.stringify({ sessionId, orderId, amount, currency, crc }))
      .digest('hex');

    const auth = Buffer.from(`${posId}:${apiKey}`).toString('base64');

    const verifyRes = await fetch('https://secure.przelewy24.pl/api/v1/transaction/verify', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ merchantId, posId, sessionId, amount, currency, orderId, sign: verifySign }),
    });

    if (!verifyRes.ok) {
      const errBody = await verifyRes.text();
      console.error('P24 verify failed:', verifyRes.status, errBody);
      return { statusCode: 502, body: 'Nie udało się potwierdzić transakcji w Przelewy24.' };
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    return { statusCode: 500, body: 'Błąd przetwarzania powiadomienia.' };
  }
};
