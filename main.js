let dataset;
let graph;

let currentYear;
let currentFilter = "all";

const svg = d3.select("#graph");
const canvas = document.getElementById("canvas");

const yearSlider = document.getElementById("yearSlider");
const yearLabel = document.getElementById("yearLabel");
const details = document.getElementById("details");

const colorByNodeType = {
    building: "#ec1763",
    owner: "#5568af",
    tenant: "#cdd629"
};

const colorByHyperedgeType = {
    ownership: "#f8c9dd",
    tenancy: "#ceeaee",
    family: "#ceeaee",
    eviction: "#e15759"
};

const simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.id).distance(120).strength(0.25))
    .force("charge", d3.forceManyBody().strength(-450))
    .force("center", d3.forceCenter())
    .force("collision", d3.forceCollide().radius(d => d.radius + 8));

let graphRoot;
let linkLayer;
let hyperedgeLayer;
let nodeLayer;
let labelLayer;

init();

async function init() {
    dataset = await fetch("dataset.json").then(response => response.json());

    graph = buildHypergraph(dataset);

    setupYearSlider();
    setupFilters();
    setupSvg();

    updateVisualization();
}

function buildHypergraph(data) {
    const nodes = [];
    const nodesById = new Map();
    const hyperedges = [];

    function addNode(node) {
        nodes.push(node);
        nodesById.set(node.id, node);
    }

    data.buildings.forEach(building => {
        addNode({
            id: `building:${building.building_id}`,
            type: "building",
            label: `Building ${building.building_id}`,
            radius: 16,
            raw: building
        });
    });

    data.owners.forEach(owner => {
        addNode({
            id: `owner:${owner.owner_id}`,
            type: "owner",
            label: `${owner.name} ${owner.surname}`,
            radius: 13,
            raw: owner
        });
    });

    data.tenants.forEach(tenant => {
        addNode({
            id: `tenant:${tenant.tenant_id}`,
            type: "tenant",
            label: `${tenant.name} ${tenant.surname}`,
            radius: 11,
            raw: tenant
        });
    });

    data.ownership_contracts.forEach((contract, index) => {
        hyperedges.push({
            id: `ownership:${index}`,
            type: "ownership",
            label: `Ownership ${contract.ownership_start_year}-${contract.ownership_end_year}`,
            members: [
                `building:${contract.building_id}`,
                `owner:${contract.owner_id}`
            ],
            startYear: contract.ownership_start_year,
            endYear: contract.ownership_end_year,
            raw: contract
        });
    });

    data.tenancy_contracts.forEach((contract, index) => {
        hyperedges.push({
            id: `tenancy:${index}`,
            type: "tenancy",
            label: `Rent ${contract.renting_start_year}-${contract.renting_end_year}`,
            members: [
                `tenant:${contract.tenant_id}`,
                `owner:${contract.owner_id}`
            ],
            startYear: contract.renting_start_year,
            endYear: contract.renting_end_year,
            raw: contract
        });
    });

    const tenantsByFamily = d3.group(data.tenants, d => d.family_id);

    tenantsByFamily.forEach((familyTenants, familyId) => {
        if (familyTenants.length < 2) return;

        hyperedges.push({
            id: `family:${familyId}`,
            type: "family",
            label: `Family ${familyId}`,
            members: familyTenants.map(t => `tenant:${t.tenant_id}`),
            startYear: null,
            endYear: null,
            raw: {
                family_id: familyId,
                tenants: familyTenants
            }
        });
    });

    const buildingsByEvictionYear = d3.group(data.buildings, d => d.eviction_year);

    buildingsByEvictionYear.forEach((buildings, year) => {
        if (buildings.length < 2) return;

        hyperedges.push({
            id: `eviction:${year}`,
            type: "eviction",
            label: `Evicted in ${year}`,
            members: buildings.map(b => `building:${b.building_id}`),
            startYear: year,
            endYear: year,
            raw: {
                eviction_year: year,
                buildings
            }
        });
    });

    return {
        nodes,
        nodesById,
        hyperedges
    };
}

function setupYearSlider() {
    const years = [];

    graph.hyperedges.forEach(edge => {
        if (edge.startYear !== null) years.push(edge.startYear);
        if (edge.endYear !== null) years.push(edge.endYear);
    });

    const minYear = d3.min(years);
    const maxYear = d3.max(years);

    currentYear = minYear;

    yearSlider.min = minYear;
    yearSlider.max = maxYear;
    yearSlider.value = currentYear;
    yearLabel.textContent = currentYear;

    yearSlider.addEventListener("input", () => {
        currentYear = Number(yearSlider.value);
        yearLabel.textContent = currentYear;
        updateVisualization();
    });
}

function setupFilters() {
    document.querySelectorAll("button.filter").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll("button.filter").forEach(b => {
                b.classList.remove("active");
            });

            button.classList.add("active");

            currentFilter = button.dataset.type;
            updateVisualization();
        });
    });
}

function setupSvg() {
    svg.selectAll("*").remove();

    graphRoot = svg.append("g").attr("class", "graph-root");

    hyperedgeLayer = graphRoot.append("g").attr("class", "hyperedge-layer");
    linkLayer = graphRoot.append("g").attr("class", "link-layer");
    nodeLayer = graphRoot.append("g").attr("class", "node-layer");
    labelLayer = graphRoot.append("g").attr("class", "label-layer");

    const zoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on("zoom", event => {
            graphRoot.attr("transform", event.transform);
        });

    svg.call(zoom);

    resizeSvg();

    window.addEventListener("resize", () => {
        resizeSvg();
        updateVisualization();
    });
}

function resizeSvg() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    svg
        .attr("width", width)
        .attr("height", height)
        .attr("viewBox", `0 0 ${width} ${height}`);

    simulation.force("center", d3.forceCenter(width / 2, height / 2));
}

function getActiveHyperedges() {
    return graph.hyperedges.filter(edge => {
        const typeIsVisible =
            currentFilter === "all" || edge.type === currentFilter;

        const yearIsVisible =
            edge.startYear === null ||
            edge.endYear === null ||
            (currentYear >= edge.startYear && currentYear <= edge.endYear);

        return typeIsVisible && yearIsVisible;
    });
}

function createLinksFromHyperedges(hyperedges) {
    const links = [];

    hyperedges.forEach(edge => {
        for (let i = 0; i < edge.members.length; i++) {
            for (let j = i + 1; j < edge.members.length; j++) {
                links.push({
                    id: `${edge.id}:${i}-${j}`,
                    source: edge.members[i],
                    target: edge.members[j],
                    hyperedge: edge
                });
            }
        }
    });

    return links;
}

function updateVisualization() {
    const activeHyperedges = getActiveHyperedges();
    const activeLinks = createLinksFromHyperedges(activeHyperedges);

    const activeNodeIds = new Set();

    activeHyperedges.forEach(edge => {
        edge.members.forEach(id => activeNodeIds.add(id));
    });

    const links = linkLayer
        .selectAll("line")
        .data(activeLinks, d => d.id)
        .join("line")
        .attr("class", "link");

    const hyperedges = hyperedgeLayer
        .selectAll("path")
        .data(activeHyperedges, d => d.id)
        .join("path")
        .attr("class", "hyperedge")
        .attr("fill", d => colorByHyperedgeType[d.type])
        .attr("stroke", d => colorByHyperedgeType[d.type]);

    const hyperedgeLabels = labelLayer
        .selectAll("text.hyperedge-label")
        .data(activeHyperedges, d => d.id)
        .join("text")
        .attr("class", "hyperedge-label")
        .text(d => d.label);

    const nodes = nodeLayer
        .selectAll("g.node")
        .data(graph.nodes, d => d.id)
        .join(enter => {
            const g = enter
                .append("g")
                .attr("class", "node")
                .call(drag(simulation));

            g.append("circle")
                .attr("r", d => d.radius)
                .attr("fill", d => colorByNodeType[d.type]);

            g.append("text")
                .attr("x", 18)
                .attr("y", 4)
                .text(d => d.label);

            g.on("click", (event, d) => {
                showDetails(d);
            });

            return g;
        });

    nodes.classed("inactive", d => !activeNodeIds.has(d.id) && activeHyperedges.length > 0);

    simulation.nodes(graph.nodes);

    simulation
        .force("x", d3.forceX(canvas.clientWidth / 2).strength(0.04))
        .force("y", d3.forceY(canvas.clientHeight / 2).strength(0.04));

    simulation.force("link")
        .links(activeLinks);

    simulation.alpha(0.8).restart();

    simulation.on("tick", () => {
        links
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        nodes
            .attr("transform", d => `translate(${d.x}, ${d.y})`);

        hyperedges
            .attr("d", d => createHullPath(d));

        hyperedgeLabels
            .attr("x", d => getHyperedgeCenter(d).x)
            .attr("y", d => getHyperedgeCenter(d).y);
    });
}

function createHullPath(edge) {
    const padding = 28;
    const points = [];

    edge.members.forEach(memberId => {
        const node = graph.nodesById.get(memberId);

        if (!node || node.x === undefined || node.y === undefined) return;

        points.push([node.x - padding, node.y - padding]);
        points.push([node.x + padding, node.y - padding]);
        points.push([node.x + padding, node.y + padding]);
        points.push([node.x - padding, node.y + padding]);
    });

    const hull = d3.polygonHull(points);

    if (!hull) return "";

    return d3.line()
        .curve(d3.curveCatmullRomClosed)
        (hull);
}

function getHyperedgeCenter(edge) {
    const memberNodes = edge.members
        .map(id => graph.nodesById.get(id))
        .filter(node => node && node.x !== undefined && node.y !== undefined);

    if (memberNodes.length === 0) {
        return { x: 0, y: 0 };
    }

    return {
        x: d3.mean(memberNodes, d => d.x),
        y: d3.mean(memberNodes, d => d.y)
    };
}

function showDetails(node) {
    const raw = node.raw;

    let html = `
        <h3>${node.label}</h3>
        <p><b>Type:</b> ${node.type}</p>
    `;

    if (node.type === "building") {
        html += `
            <p><b>Building ID:</b> ${raw.building_id}</p>
            <p><b>Surface:</b> ${raw.surface_m2} m²</p>
            <p><b>Eviction year:</b> ${raw.eviction_year}</p>
        `;
    }

    if (node.type === "owner") {
        html += `
            <p><b>Owner ID:</b> ${raw.owner_id}</p>
            <p><b>Name:</b> ${raw.name} ${raw.surname}</p>
            <p><b>Compensation:</b> ${raw.compensation_for_eviction}</p>
        `;
    }

    if (node.type === "tenant") {
        html += `
            <p><b>Tenant ID:</b> ${raw.tenant_id}</p>
            <p><b>Family:</b> ${raw.family_id}</p>
            <p><b>Name:</b> ${raw.name} ${raw.surname}</p>
            <p><b>Profession:</b> ${raw.profession}</p>
        `;
    }

    details.innerHTML = html;
}

function drag(simulation) {
    function dragStarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();

        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragEnded(event, d) {
        if (!event.active) simulation.alphaTarget(0);

        d.fx = null;
        d.fy = null;
    }

    return d3.drag()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded);
}