export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      })
    }

    const url = new URL(request.url)
    const week = url.searchParams.get('week') === 'next' ? 'nextweek' : 'thisweek'
    const ffURL = `https://nfs.faireconomy.media/ff_calendar_${week}.json`

    try {
      const ffResponse = await fetch(ffURL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.forexfactory.com/',
          'Origin': 'https://www.forexfactory.com',
        },
      })

      const data = await ffResponse.text()

      return new Response(data, {
        status: ffResponse.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
          'X-Proxied-From': 'ForexFactory',
          'X-Week': week,
        },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }
  },
}
