# FileExplorerPro
Program meant to make it easier to organize/sort and view your collected Stable Diffusion checkpoints and lora 

I made this entirely for personal use, but after the program started growing and growing I decided it should be refined and published as a useful tool. It's heavily biased towards my personal workflow and very very very far from optimized. I welcome anyone who actually knows what they are doing to contribute to helping optimize and improve the program, because I genuinely think it's a useful tool and I hope that others may find it useful too.

Issues & Feedback wanted:
Biggest issue I'm aware of: This program absolutely EATS RAM. I think because I'm not chunking files and only loading partial/visibile files, but instead just loading everything? I used to do chunking in earlier iterations but it was so much clunkier and I don't think I implemented it well...

I use this program alongside StabilityMatrix - as it downloads a <checkpointName>.preview.<imgext> and <checkpointName>.cm-info.json file that this program utilizes which is very convenient. Not necessary though

