# Tono

A singing practice app for beginners and anyone who wants to improve their voice. Find your range, match notes, learn a song line by line, sing karaoke, and get feedback on how you sang it.

**Live:** https://seeknowhere.github.io/Pitch-staff/

## What's inside

| Tab | What it does |
|---|---|
| **Lessons** | A 5-minute daily warm-up set to your range, plus step-by-step courses (Foundations, Pitch, more coming) with breathing, hiss, siren and note-matching exercises. Tracks your streak. |
| **Tuner** | A live pitch meter. **Match a note** plays a note for you to sing back. **My range** finds your lowest and highest notes and your voice type. |
| **Practice** | Load a song and learn it line by line: see the notes, loop a line, and use "Repeat after me" with feedback on each try. Also builds a practice plan from your weakest lines. |
| **Karaoke** | Sing along over the instrumental with lyrics that light up in time with the song, then get a score. |
| **Analyze** | Upload a recording of yourself and compare it with the original: a note-by-note chart, a score per line, timing and breath feedback, and your progress over time. |

**Loading a song:** you can upload a vocal track and an instrumental, or upload a normal song and let Tono split it into vocals and music for you, or pick one from the sample library. Lyrics can be added from an `.lrc` file or found online.

**Privacy:** pitch detection, note detection and song splitting all run in your browser. Your recordings aren't uploaded anywhere. Your progress is saved in the browser on your device, and there's no account.

## Tech

- [React](https://react.dev) with JSX, built with [Vite](https://vite.dev)
- [Tailwind CSS](https://tailwindcss.com) for styling
- [Oxlint](https://oxc.rs) for linting
- Web Audio API for the mic, pitch tracking and playback
- [Basic Pitch](https://github.com/spotify/basic-pitch) for high-accuracy note detection
- An [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui) MDX-Net model running on [ONNX Runtime Web](https://onnxruntime.ai) for splitting songs
- [LRCLIB](https://lrclib.net) for finding synced lyrics

## Run it locally

You need [Node.js](https://nodejs.org) 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Then open the link it prints (usually http://localhost:5173). The mic works on `localhost`.

Other commands:

```bash
npm run build     # build the site into dist/
npm run preview   # serve the built site locally, exactly like the live version
npx oxlint src    # check the code for mistakes
```

## Project structure

```
src/
  main.jsx        starts the app
  App.jsx         the tabs, the chosen song and the live mic
  components/     shared UI pieces (Sheet, Keyboard, MelodyMap, Dial…)
  lib/            logic with no UI: pitch, music theory, analysis, lyrics, storage…
  song/           the "Pick a song" screens
  tabs/
    lessons/      Lessons tab, exercises and course data
    tuner/        Match a note, My range, Song fit
    practice/     Practice tab, song sheet, practice plan
    karaoke/      Karaoke tab
    analyze/      Analyze tab and charts
public/
  bp-model/       Basic Pitch model
  sep/            song-splitting model and worker
```

Each file starts with a one-line comment that says what it's for.

## Deploying

Every push to the `vite` branch builds the app and publishes it to GitHub Pages automatically (see `.github/workflows/deploy.yml`). It takes about a minute. Check the **Actions** tab to see if a deploy worked.

## Credits and licenses

- **Basic Pitch** by Spotify, Apache License 2.0. See `public/bp-model/LICENSE-basic-pitch.txt`.
- **UVR_MDXNET_KARA_2** model from [Ultimate Vocal Remover](https://github.com/Anjok07/ultimatevocalremovergui) (MIT). Thank you to UVR and its developers. See `public/sep/NOTICE.txt`.
- **ONNX Runtime Web** by Microsoft, MIT License. See `public/sep/ort/LICENSE-onnxruntime.txt`.
- Synced lyrics from [LRCLIB](https://lrclib.net).
