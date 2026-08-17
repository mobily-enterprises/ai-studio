# Stack

## Stack packages
- `genesis-stack`

## Components
- `nodejs`
- `jskit`
- `vue`
- `shell`

## Launch

### Target `app`: Run Vibe64

- Default.
- Preferred port: `3000`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`
- Runtimes: `nodejs`
- Serve `Develop`: `npm` `run` `dev` `--` `--host` `{host}` `--port` `{port}`

## Deployment

- Runtimes: `nodejs`
- Ready when: `GET` `/api/health` returns `200`
- Prepare `Install dependencies`: `npm` `install`
- Build `Build`: `npm` `run` `build`
- Serve `Start`: `npm` `start`
