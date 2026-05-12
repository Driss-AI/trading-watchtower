// Deduplicate mirror round trips (TopstepX reports both sides of each trade)
      const deduped: RoundTrip[] = []
      const seen = new Set<string>()
      for (const rt of roundTrips) {
        const key1 = `${rt.entry}-${rt.exit}-${rt.contracts}`
        const key2 = `${rt.exit}-${rt.entry}-${rt.contracts}`
        if (seen.has(key1) || seen.has(key2)) continue
        seen.add(key1)
        deduped.push(rt)
      }
