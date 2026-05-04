export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
      })
    }

    const url = new URL(request.url)
    const week = url.searchParams.get('week') === 'next' ? 'nextweek' : 'thisweek'

    // Try multiple ForexFactory endpoint formats
    const urls = [
      `https://nfs.faireconomy.media/ff_calendar_${week}.json?version=2`,
      `https://nfs.faireconomy.media/ff_calendar_${week}.json`,
      `https://cdn-nfs.faireconomy.media/ff_calendar_${week}.json`,
    ]

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.forexfactory.com/',
      'Origin': 'https://www.forexfactory.com',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    }

    let lastError = ''
    for (const ffURL of urls) {
      try {
        const resp = await fetch(ffURL, { headers })
        if (resp.ok) {
          const data = await resp.text()
          return new Response(data, {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=3600',
              'X-Source-URL': ffURL,
            },
          })
        }
        lastError = `${ffURL} -> ${resp.status}`
      } catch (err) {
        lastError = `${ffURL} -> ${err}`
      }
    }

    return new Response(JSON.stringify({ error: 'All FF endpoints failed', last: lastError }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  },
}
