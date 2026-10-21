--[[
  EltesRobloxBridge — Studio plugin for the Eltes MCP bridge.

  Install: save this file in your Roblox Studio Plugins folder
    Windows: %LOCALAPPDATA%\Roblox\Plugins
    macOS:   ~/Documents/Roblox/Plugins
  Then restart Studio, and press "Connect" on the Eltes toolbar button.

  Required: Game Settings → Security → Allow HTTP Requests.
  The bridge must be running:  node mcp/eltes-roblox-bridge.mjs --port 8410

  The plugin is a client: it polls the bridge for work and applies it to the
  open place. It never runs arbitrary code from the network — every op is one
  of the functions below.
]]

local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")
local AnimationClipProvider = game:GetService("AnimationClipProvider")

local BASE = "http://127.0.0.1:8410"
local TOKEN = "" -- set to the bridge token if you started it with --token

local running = false
local connections = {}

local function headers()
	local list = { ["Content-Type"] = "application/json" }
	if TOKEN ~= "" then list["Authorization"] = "Bearer " .. TOKEN end
	return list
end

local function request(method, path, body)
	local options = {
		Url = BASE .. path,
		Method = method,
		Headers = headers()
	}
	if body ~= nil then
		options.Body = HttpService:JSONEncode(body)
	end
	local ok, response = pcall(function()
		return HttpService:RequestAsync(options)
	end)
	if not ok then
		return nil, tostring(response)
	end
	if not response.Success then
		return nil, string.format("HTTP %d %s", response.StatusCode, response.StatusMessage or "")
	end
	if response.Body == nil or response.Body == "" then
		return {}, nil
	end
	local decoded, err = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decoded then
		return nil, tostring(err)
	end
	return decoded, nil
end

--------------------------------------------------------------------- helpers

local function vec(value, fallback)
	if type(value) ~= "table" then return fallback end
	return Vector3.new(tonumber(value.x) or fallback.X, tonumber(value.y) or fallback.Y, tonumber(value.z) or fallback.Z)
end

local function color(value, fallback)
	if type(value) ~= "string" or value == "" then return fallback end
	if value:sub(1, 1) == "#" and #value >= 7 then
		local ok, parsed = pcall(function()
			return Color3.fromHex(value)
		end)
		if ok then return parsed end
	end
	local ok, brick = pcall(function()
		return BrickColor.new(value).Color
	end)
	if ok then return brick end
	return fallback
end

local function find(target)
	if type(target) ~= "string" or target == "" then return nil end
	if target == "Workspace" then return workspace end
	local direct = workspace:FindFirstChild(target, true)
	if direct then return direct end
	local current = workspace
	for piece in string.gmatch(target, "[^%.]+") do
		current = current and current:FindFirstChild(piece)
	end
	return current
end

local function makePart(spec, parent)
	local part = Instance.new(spec.className or "Part")
	part.Name = spec.name or "Part"
	part.Anchored = spec.anchored ~= false
	if spec.size then part.Size = vec(spec.size, part.Size) end
	if spec.position then part.Position = vec(spec.position, part.Position) end
	part.Color = color(spec.color, part.Color)
	if spec.material then
		local ok, material = pcall(function()
			return Enum.Material[spec.material]
		end)
		if ok then part.Material = material end
	end
	if type(spec.transparency) == "number" then part.Transparency = spec.transparency end
	part.Parent = parent
	return part
end

local function record(name, fn)
	local id
	pcall(function()
		id = ChangeHistoryService:TryBeginRecording(name)
	end)
	local ok, output = fn()
	pcall(function()
		if id then ChangeHistoryService:FinishRecording(id, Enum.FinishRecordingOperation.Commit) end
	end)
	return ok, output
end

---------------------------------------------------------------------- effects

local EFFECT_BUILDERS = {
	particles = function(target, spec)
		local emitter = Instance.new("ParticleEmitter")
		emitter.Color = ColorSequence.new(color(spec.color, Color3.fromRGB(57, 220, 162)))
		emitter.Rate = 24
		emitter.Lifetime = NumberRange.new(0.6, 1.4)
		emitter.Speed = NumberRange.new(3, 7)
		emitter.SpreadAngle = Vector2.new(180, 180)
		emitter.Texture = spec.texture or "rbxasset://textures/particles/sparkles_main.dds"
		emitter.Parent = target
		return emitter
	end,
	fire = function(target, spec)
		local fire = Instance.new("Fire")
		fire.Color = color(spec.color, Color3.fromRGB(255, 120, 40))
		fire.Size = 6
		fire.Heat = 12
		fire.Parent = target
		return fire
	end,
	sparkles = function(target, spec)
		local sparkles = Instance.new("Sparkles")
		sparkles.SparkleColor = color(spec.color, Color3.fromRGB(255, 255, 255))
		sparkles.Parent = target
		return sparkles
	end,
	smoke = function(target, spec)
		local smoke = Instance.new("Smoke")
		smoke.Color = color(spec.color, Color3.fromRGB(120, 120, 120))
		smoke.Size = 4
		smoke.Parent = target
		return smoke
	end,
	trail = function(target, spec)
		local trail = Instance.new("Trail")
		trail.Color = ColorSequence.new(color(spec.color, Color3.fromRGB(57, 220, 162)))
		trail.Lifetime = 0.8
		trail.Parent = target
		return trail
	end,
	beam = function(target, spec)
		local beam = Instance.new("Beam")
		beam.Color = ColorSequence.new(color(spec.color, Color3.fromRGB(57, 220, 162)))
		beam.Width0 = 0.4
		beam.Width1 = 0.4
		beam.FaceCamera = true
		beam.Parent = target
		return beam
	end
}

------------------------------------------------------------------- generators

local function hudSource(title)
	return table.concat({
		'local Players = game:GetService("Players")',
		'local player = Players.LocalPlayer',
		'local gui = Instance.new("ScreenGui")',
		'gui.Name = "Hud"',
		'gui.ResetOnSpawn = false',
		'gui.Parent = player:WaitForChild("PlayerGui")',
		'local label = Instance.new("TextLabel")',
		'label.Size = UDim2.fromOffset(260, 44)',
		'label.Position = UDim2.new(0, 16, 0, 16)',
		'label.BackgroundColor3 = Color3.fromRGB(8, 12, 18)',
		'label.TextColor3 = Color3.fromRGB(57, 220, 162)',
		'label.Font = Enum.Font.GothamBold',
		'label.TextSize = 16',
		'label.Text = "' .. title .. '"',
		'label.Parent = gui'
	}, "\n")
end

local function serverSource(genre, name, rounds)
	if genre == "tycoon" then
		return table.concat({
			'-- ' .. name .. ' · generated by Eltes',
			'local Players = game:GetService("Players")',
			'local cash = {}',
			'Players.PlayerAdded:Connect(function(player)',
			'	cash[player] = 0',
			'	local stats = Instance.new("Folder")',
			'	stats.Name = "leaderstats"',
			'	stats.Parent = player',
			'	local money = Instance.new("IntValue")',
			'	money.Name = "Cash"',
			'	money.Parent = stats',
			'	task.spawn(function()',
			'		while player.Parent do',
			'			cash[player] = cash[player] + 5',
			'			money.Value = cash[player]',
			'			task.wait(1)',
			'		end',
			'	end)',
			'end)',
			'Players.PlayerRemoving:Connect(function(player) cash[player] = nil end)'
		}, "\n")
	elseif genre == "arena" then
		return table.concat({
			'-- ' .. name .. ' · generated by Eltes',
			'local Players = game:GetService("Players")',
			'local ROUND = ' .. tostring(rounds),
			'while true do',
			'	for _, player in ipairs(Players:GetPlayers()) do',
			'		local character = player.Character or player.CharacterAdded:Wait()',
			'		local humanoid = character:FindFirstChildOfClass("Humanoid")',
			'		if humanoid then humanoid.Health = humanoid.MaxHealth end',
			'		player:LoadCharacter()',
			'	end',
			'	task.wait(ROUND)',
			'end'
		}, "\n")
	end
	return table.concat({
		'-- ' .. name .. ' · generated by Eltes',
		'local Players = game:GetService("Players")',
		'local checkpoint = workspace:WaitForChild("' .. name .. '"):WaitForChild("Spawn")',
		'Players.PlayerAdded:Connect(function(player)',
		'	player.CharacterAdded:Connect(function(character)',
		'		task.wait(0.2)',
		'		local root = character:FindFirstChild("HumanoidRootPart")',
		'		if root and checkpoint then',
		'			root.CFrame = checkpoint.CFrame + Vector3.new(0, 4, 0)',
		'		end',
		'	end)',
		'end)'
	}, "\n")
end

----------------------------------------------------------------------- ops

local ops = {}

function ops.scene_report(args)
	local parts = 0
	for _, item in ipairs(workspace:GetDescendants()) do
		if item:IsA("BasePart") then parts = parts + 1 end
	end
	local scripts = 0
	for _, item in ipairs(game:GetDescendants()) do
		if item:IsA("Script") or item:IsA("LocalScript") or item:IsA("ModuleScript") then scripts = scripts + 1 end
	end
	local selected = {}
	for _, item in ipairs(Selection:Get()) do table.insert(selected, item.Name) end
	local output = table.concat({
		string.format("Place: %s", game.Name),
		string.format("Parts: %d · Scripts: %d", parts, scripts),
		string.format("Workspace children: %d", #workspace:GetChildren()),
		"Selection: " .. (#selected > 0 and table.concat(selected, ", ") or "nothing")
	}, "\n")
	return true, output
end

function ops.create_part(args)
	return record("Eltes: create part", function()
		local part = makePart(args, workspace)
		return true, string.format("Created %s (%s) at %.1f, %.1f, %.1f", part.Name, part.ClassName, part.Position.X, part.Position.Y, part.Position.Z)
	end)
end

function ops.build_model(args)
	return record("Eltes: build model", function()
		if type(args.parts) ~= "table" or #args.parts == 0 then
			return false, "No parts were given."
		end
		local model = Instance.new("Model")
		model.Name = args.name or "EltesModel"
		model.Parent = workspace
		local offset = vec(args.position, Vector3.new(0, 0, 0))
		for _, spec in ipairs(args.parts) do
			local part = makePart(spec, model)
			part.Position = part.Position + offset
		end
		local pivot = model:GetPivot()
		model.PrimaryPart = model:FindFirstChildWhichIsA("BasePart")
		return true, string.format("Built %s with %d parts around %.0f, %.0f, %.0f", model.Name, #args.parts, pivot.X, pivot.Y, pivot.Z)
	end)
end

function ops.insert_script(args)
	return record("Eltes: insert script", function()
		if type(args.source) ~= "string" or args.source == "" then return false, "No source given." end
		local kind = args.kind or "server"
		local parent = ServerScriptService
		local class = "Script"
		if kind == "client" then
			parent = game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts")
			class = "LocalScript"
		elseif kind == "module" then
			parent = game:GetService("ReplicatedStorage")
			class = "ModuleScript"
		end
		local script = Instance.new(class)
		script.Name = args.name or "EltesScript"
		script.Source = args.source
		script.Parent = parent
		return true, string.format("Inserted %s (%s) into %s", script:GetFullName(), class, parent.Name)
	end)
end

function ops.animate_rig(args)
	return record("Eltes: animate rig", function()
		local rig = find(args.rig) or (Selection:Get()[1])
		if not rig or not rig:IsA("Model") then
			return false, "Pick a rig model first (select it, or pass the model name)."
		end
		local sequence = Instance.new("KeyframeSequence")
		sequence.Name = (args.name or "EltesAnimation")
		sequence.Loop = args.looped ~= false
		sequence.Priority = Enum.AnimationPriority.Action
		for _, frame in ipairs(args.keyframes or {}) do
			local keyframe = Instance.new("Keyframe")
			keyframe.Time = tonumber(frame.time) or 0
			for jointName, rotation in pairs(frame.joints or {}) do
				local pose = Instance.new("Pose")
				pose.Name = jointName
				local rx, ry, rz = 0, 0, 0
				if type(rotation) == "table" then
					rx, ry, rz = tonumber(rotation[1]) or 0, tonumber(rotation[2]) or 0, tonumber(rotation[3]) or 0
				end
				pose.CFrame = CFrame.Angles(math.rad(rx), math.rad(ry), math.rad(rz))
				pose.Parent = keyframe
			end
			keyframe.Parent = sequence
		end
		sequence.Parent = rig
		local ok, clip = pcall(function()
			return AnimationClipProvider:RegisterAnimationClip(sequence)
		end)
		if not ok then
			return false, "Could not register the animation clip: " .. tostring(clip)
		end
		local animation = Instance.new("Animation")
		animation.Name = sequence.Name
		animation.AnimationId = clip
		animation.Parent = rig
		return true, string.format("Built %s (%d keyframes) on %s. Press Play to preview it.", sequence.Name, #sequence:GetChildren(), rig.Name)
	end)
end

function ops.add_effect(args)
	return record("Eltes: add effect", function()
		local target = find(args.target)
		if not target then return false, "No instance named " .. tostring(args.target) end
		local builder = EFFECT_BUILDERS[args.kind]
		if not builder then return false, "Unknown effect: " .. tostring(args.kind) end
		local effect = builder(target, args)
		return true, string.format("Added %s to %s", effect.ClassName, target:GetFullName())
	end)
end

function ops.set_properties(args)
	return record("Eltes: set properties", function()
		local target = find(args.target)
		if not target then return false, "No instance named " .. tostring(args.target) end
		local applied = 0
		local targets = args.children and target:GetDescendants() or { target }
		for _, item in ipairs(targets) do
			for key, value in pairs(args.properties or {}) do
				local ok = pcall(function()
					if typeof(value) == "table" and value.x and value.y and value.z then
						item[key] = Vector3.new(value.x, value.y, value.z)
					elseif type(value) == "string" and value:sub(1, 1) == "#" then
						item[key] = Color3.fromHex(value)
					else
						item[key] = value
					end
				end)
				if ok then applied = applied + 1 end
			end
		end
		return true, string.format("Set %d properties on %s", applied, target:GetFullName())
	end)
end

function ops.scaffold_game(args)
	return record("Eltes: scaffold game", function()
		local genre = args.genre or "obby"
		local name = args.name or ("Eltes" .. genre:sub(1, 1):upper() .. genre:sub(2))
		local root = workspace:FindFirstChild(name) or Instance.new("Folder")
		root.Name = name
		root.Parent = workspace

		local base = root:FindFirstChild("Baseplate") or Instance.new("Part")
		base.Name = "Baseplate"
		base.Size = Vector3.new(160, 2, 160)
		base.Position = Vector3.new(0, -1, 0)
		base.Anchored = true
		base.Color = Color3.fromRGB(24, 30, 38)
		base.Material = Enum.Material.Slate
		base.Parent = root

		local spawnPoint = root:FindFirstChild("Spawn") or Instance.new("SpawnLocation")
		spawnPoint.Name = "Spawn"
		spawnPoint.Size = Vector3.new(12, 1, 12)
		spawnPoint.Position = Vector3.new(0, 1, 0)
		spawnPoint.Anchored = true
		spawnPoint.Color = Color3.fromRGB(57, 220, 162)
		spawnPoint.Parent = root

		local shared = game:GetService("ReplicatedStorage"):FindFirstChild(name .. "Shared") or Instance.new("Folder")
		shared.Name = name .. "Shared"
		shared.Parent = game:GetService("ReplicatedStorage")

		local server = ServerScriptService:FindFirstChild(name .. "Server")
		if server then server:Destroy() end
		server = Instance.new("Script")
		server.Name = name .. "Server"
		server.Source = serverSource(genre, name, tonumber(args.rounds) or 90)
		server.Parent = ServerScriptService

		local gui = game:GetService("StarterGui"):FindFirstChild(name .. "Gui")
		if gui then gui:Destroy() end
		gui = Instance.new("LocalScript")
		gui.Name = name .. "Gui"
		gui.Source = hudSource(name .. " · " .. genre)
		gui.Parent = game:GetService("StarterPlayer"):FindFirstChild("StarterPlayerScripts")

		if genre == "obby" then
			for index = 1, 5 do
				local platform = Instance.new("Part")
				platform.Name = "Platform" .. index
				platform.Size = Vector3.new(8, 1, 8)
				platform.Position = Vector3.new(0, 1 + index * 4, -index * 14)
				platform.Anchored = true
				platform.Color = Color3.fromRGB(57, 220, 162)
				platform.Material = Enum.Material.Neon
				platform.Parent = root
			end
		end

		return true, string.format("Scaffolded %s (%s): baseplate, spawn, server loop, HUD%s. Press Play to test.", name, genre, genre == "obby" and ", 5 platforms" or "")
	end)
end

------------------------------------------------------------------- transport

local function handle(command)
	local handler = ops[command.op]
	if not handler then
		return false, "Unknown op: " .. tostring(command.op)
	end
	local ok, result, message = pcall(handler, command.args or {})
	if not ok then
		return false, "The plugin raised: " .. tostring(result)
	end
	if result == false then
		return false, message or "The op failed."
	end
	return true, message or "Done."
end

local function loop()
	while running do
		local payload, err = request("GET", "/next", nil)
		if not payload then
			if running then
				warn("[Eltes] bridge unreachable: " .. tostring(err))
				task.wait(3)
			end
		elseif payload.id then
			local ok, output = handle(payload)
			request("POST", "/result", { id = payload.id, ok = ok, output = output })
			print(string.format("[Eltes] %s → %s", payload.op, output))
		end
	end
end

local toolbar = plugin:CreateToolbar("Eltes")
local button = toolbar:CreateButton("Connect", "Connect to the Eltes MCP bridge", "rbxasset://textures/ui/GuiImagePlaceholder.png")

button.Click:Connect(function()
	if running then
		running = false
		button:SetActive(false)
		print("[Eltes] disconnected")
		return
	end
	local health, err = request("GET", "/health", nil)
	if not health then
		warn("[Eltes] no bridge on " .. BASE .. " — start it with: node mcp/eltes-roblox-bridge.mjs --port 8410")
		warn("[Eltes] " .. tostring(err))
		return
	end
	running = true
	button:SetActive(true)
	print("[Eltes] connected to " .. BASE)
	task.spawn(loop)
end)

plugin.Unloading:Connect(function()
	running = false
end)
