import fakepyrint

# generate 30 seconds of stereo audio at 48Khz
# values must be in the range [-1.0, 1.0]
pcm_audio_1d = [0.1 if i % 2 == 0 else -0.1 for i in range(48000 * 30 * 2)]
pcm_audio_2d = [
    [
        0.1 if i % 2 == 0 else -0.1
        for i in range(2)
    ]
    for _ in range(48000 * 30)
]
fakeprint = fakepyrint.compute_fakeprint(pcm_audio_1d, 48000)
print("Fakeprint length:", len(fakeprint))
assert isinstance(fakeprint, list), \
"Fakeprint should be a list"
assert fakeprint == fakepyrint.compute_fakeprint_2d(pcm_audio_2d, 48000), \
"Fakeprint from 1D and 2D audio should be the same"
