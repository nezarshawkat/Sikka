# AdMob app-ads.txt

The required AdMob record is published by both the web build and the API
service:

```text
google.com, pub-2875822124723194, DIRECT, f08c47fec0942fa0
```

## Production requirement

In Google Play Console, the **Developer website** for `sikka.app` must use the
same public host that serves this repository's `/app-ads.txt` route. Do not put
the API path in that field: use the origin only. For the current Render
deployment, the value is:

```text
https://sikka-mq6w.onrender.com
```

The crawler must be able to fetch
`https://sikka-mq6w.onrender.com/app-ads.txt` anonymously with an HTTP 200
response. A 403 response means the host is blocked or protected upstream and
cannot be verified by AdMob, even if the source file is correct. Configure the
Render service/custom domain to allow public requests to this path, deploy this
change, then use AdMob's **Check for updates** action.

## Verification command

After deployment, verify the exact public origin configured in Play Console:

```bash
node scripts/check-app-ads.mjs https://sikka-mq6w.onrender.com
```

The command checks the local record first, then requires a successful public
`text/plain` response containing the exact AdMob record.
