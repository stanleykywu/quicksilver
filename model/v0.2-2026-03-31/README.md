# Quicksilver Model v1.2
_updated April 1st 2026_

This version of the model heavily scales up training for both AI and non-AI audio, and includes non-music human audio as additional negative class (not AI). 

# Dataset Breakdown

**AI audio sources**
* 30s random snippets of Suno songs
* 30s random snippets of Udio songs

**Human audio sources**
* 30s clips from FMA medium dataset (human music)
* 5-10s clips from Audioset (random human audio from YouTube)
* 5-30s clips from Mozilla's Common Voice Spontaneous Speech 3.0 (english)

## Train Dataset Breakdown

### AI
| Source | Count | % of Total |
|--------|------:|-----------:|
| suno | 104406 | 25.0% |
| udio | 104406 | 25.0% |

### Human
| Source | Count | % of Total |
|--------|------:|-----------:|
| audioset | 197258 | 47.2% |
| fma | 9952 | 2.4% |
| common_voice_en | 1602 | 0.4% |

## Test Dataset Breakdown

### AI
| Source | Count | % of Total |
|--------|------:|-----------:|
| suno | 190578 | 36.7% |
| udio | 10000 | 1.9% |

### Human
| Source | Count | % of Total |
|--------|------:|-----------:|
| audioset | 301382 | 58.0% |
| common_voice_en | 2548 | 0.5% |
| fma | 15027 | 2.9% |

# Performance

### AI
| Source | Num Samples | Num Correct | Precision | FNR |
|--------|------------:|------------:|----------:|----:|
| suno | 190578 | 186993 | 98.1189% | 1.8811% |
| udio | 10000 | 9641 | 96.4100% | 3.5900% |

### Human
| Source | Num Samples | Num Correct | Precision | FPR |
|--------|------------:|------------:|----------:|----:|
| audioset | 301382 | 301347 | 99.9884% | 0.0116% |
| common_voice_en | 2548 | 2548 | 100.0000% | 0.0000% |
| fma | 15027 | 15015 | 99.9201% | 0.0799% |